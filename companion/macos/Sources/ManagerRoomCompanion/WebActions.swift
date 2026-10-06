import Foundation

/// Local read operations plus an explicitly enabled, one-use AI send. Never writes the game.
final class WebActions: @unchecked Sendable {
    let token = UUID().uuidString + UUID().uuidString
    private let store: SnapshotStore
    private let state: CompanionState
    private let model: String
    private let apiKey: String
    private let allowSend: Bool
    private let sender: (Data, String) throws -> String
    private let now: () -> Date
    private let lock = NSLock()
    private var busy = false
    private var preview: Preview?

    private struct Context {
        let bytes: Data
        let root: [String: Any]
        let selection: String
        let success: Date
        let path: String
        let parser: String?
        var scope: [String: Any] {
            let manager = root["manager"] as? [String: Any] ?? [:]
            func text(_ value: Any?) -> Any {
                guard let value = value as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return NSNull() }
                return value.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let club = (manager["clubUid"] as? NSNumber)?.stringValue ?? manager["clubUid"] as? String ?? ""
            return ["selectionId": selection, "source": text(root["source"]), "gameDate": text(root["gameDate"]),
                    "dbVersion": text(root["dbVersion"]), "build": text(root["build"]), "clubUid": club,
                    "managerName": text(manager["name"])]
        }
        func matches(_ other: Context) -> Bool {
            selection == other.selection && path == other.path && success == other.success && bytes == other.bytes
        }
    }
    private struct Preview {
        let id: String
        let context: Context
        let body: Data
        let expires: Date
    }

    init(store: SnapshotStore, state: CompanionState, model: String = "", apiKey: String = "", allowSend: Bool = false,
         now: @escaping () -> Date = Date.init, sender: @escaping (Data, String) throws -> String = AICoach.send) {
        self.store = store; self.state = state; self.model = model; self.apiKey = apiKey
        self.allowSend = allowSend; self.now = now; self.sender = sender
    }
    var sendEnabled: Bool { allowSend && !model.isEmpty && !apiKey.isEmpty }
    func capabilities() throws -> Data {
        try encode(["version": 1, "token": token, "candidates": true, "coachPreview": !model.isEmpty,
                    "coachSend": sendEnabled, "model": model])
    }
    func authorized(_ supplied: String?) -> Bool { supplied == token }

    func perform(_ data: Data) throws -> Data {
        guard lock.withLock({ if busy { return false }; busy = true; return true }) else {
            throw CoachError.invalid("다른 요청 처리 중입니다. 완료 후 다시 시도하세요.")
        }
        defer { lock.withLock { busy = false } }
        guard data.count <= 8192, let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let action = input["action"] as? String else { throw CoachError.invalid("요청 형식이 올바르지 않습니다.") }
        let context = try current()
        guard let expected = input["scope"] as? [String: Any], NSDictionary(dictionary: expected).isEqual(to: context.scope) else {
            throw CoachError.invalid("화면과 현재 커리어·날짜·버전이 다릅니다. 새로고침 후 다시 요청하세요.")
        }
        switch action {
        case "candidates":
            guard let query = input["query"] as? String, query.utf8.count <= 200,
                  let offsetText = input["offset"] as? String, let offset = Int(offsetText), (0...250000).contains(offset),
                  let parser = context.parser else { throw CoachError.invalid("검색어·페이지 또는 파서 설정을 확인하세요.") }
            let work = FileManager.default.temporaryDirectory.appendingPathComponent("mr-web-candidates-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: work, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            defer { try? FileManager.default.removeItem(at: work) }
            let output = SnapshotStore(url: work.appendingPathComponent("snapshot.json"))
            let runner = NativeParserRunner(parserURL: URL(fileURLWithPath: parser), store: output, state: CompanionState(),
                                           candidateQuery: query, candidateOffset: offset)
            do { try runner.parse(saveURL: URL(fileURLWithPath: context.path)) }
            catch { throw CoachError.invalid("후보 검색 실패: 저장 완료와 파서 상태를 확인하세요. 기존 후보는 유지합니다.") }
            var result = try JSONSerialization.jsonObject(with: output.read()) as! [String: Any]
            guard context.matches(try current()), try candidateBase(result) == candidateBase(context.root) else {
                throw CoachError.invalid("검색 중 세이브가 갱신되었습니다. 새로고침 후 다시 검색하세요.")
            }
            result["saveId"] = context.selection
            let response = try encode(result)
            guard response.count <= 4 * 1024 * 1024 else { throw CoachError.invalid("후보 페이지가 응답 크기 제한을 초과했습니다.") }
            return response
        case "coach-preview":
            preview = nil
            guard let player = input["playerId"] as? String, let question = input["question"] as? String else {
                throw CoachError.invalid("선수와 질문을 입력하세요.")
            }
            let body = try AICoach.requestBody(snapshot: context.bytes, playerID: player, question: question, model: model)
            let ticket = Preview(id: UUID().uuidString, context: context, body: body, expires: now().addingTimeInterval(120))
            preview = ticket
            return try encode(["previewId": ticket.id, "expiresInSeconds": 120, "sendEnabled": sendEnabled,
                               "request": try JSONSerialization.jsonObject(with: body)])
        case "coach-send":
            guard sendEnabled else { throw CoachError.invalid("Mac에서 모델·API 키를 설정하고 --enable-web-coach로 다시 시작하세요.") }
            guard let ticket = preview, input["previewId"] as? String == ticket.id else {
                throw CoachError.invalid("유효한 미리보기가 없습니다. 요청 내용을 다시 확인하세요.")
            }
            // Consume before the network call: double clicks, disconnects and retries cannot resend it.
            preview = nil
            guard ticket.expires > now(), ticket.context.matches(context) else {
                throw CoachError.invalid("미리보기가 만료되었거나 세이브가 변경되었습니다. 다시 확인하세요.")
            }
            let answer: String
            do { answer = try sender(ticket.body, apiKey) }
            catch { throw CoachError.invalid("AI 요청이 완료되지 않았습니다. 자동 재전송하지 않습니다. 제공자 사용 내역을 확인한 뒤 새 미리보기로 재시도하세요.") }
            guard let updated = try? current(), context.matches(updated) else {
                throw CoachError.invalid("AI 처리 중 세이브가 변경되어 응답 표시를 보류했습니다. 요청은 이미 전송되었으며 자동 재전송하지 않습니다.")
            }
            return try encode(["answer": answer, "scope": context.scope, "interpretationOnly": true])
        default: throw CoachError.invalid("지원하지 않는 작업입니다.")
        }
    }
    private func current() throws -> Context {
        let before = state.snapshot()
        guard !before.parsing, before.lastError == nil, let success = before.lastSuccessAt,
              let selection = before.selectionId, let path = before.selectedSavePath,
              before.lastSavePath == path else { throw CoachError.invalid("고정한 커리어의 최신 파싱이 완료된 후 요청하세요.") }
        let bytes = try store.read(); try SnapshotValidation.validate(bytes)
        let after = state.snapshot()
        guard !after.parsing, after.lastError == nil, after.lastSuccessAt == success,
              after.selectionId == selection, after.selectedSavePath == path else {
            throw CoachError.invalid("세이브 갱신 중입니다. 잠시 후 다시 요청하세요.")
        }
        return Context(bytes: bytes, root: try JSONSerialization.jsonObject(with: bytes) as! [String: Any],
                       selection: selection, success: success, path: path, parser: after.parserPath)
    }
    private func candidateBase(_ root: [String: Any]) throws -> Data {
        var value = root
        value.removeValue(forKey: "externalCandidates"); value.removeValue(forKey: "candidateSearch")
        value.removeValue(forKey: "saveId")
        if var coverage = value["coverage"] as? [String: Any] {
            coverage.removeValue(forKey: "externalCandidates"); value["coverage"] = coverage
        }
        return try encode(value)
    }
    private func encode(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
}
