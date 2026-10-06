import Foundation

/// Local read operations plus an explicitly enabled, one-use AI send. Never writes the game.
final class WebActions: @unchecked Sendable {
    let token = UUID().uuidString + UUID().uuidString
    private let store: SnapshotStore
    private let state: CompanionState
    private let model: String
    private let apiKey: String
    private let allowSend: Bool
    private let chatGPT: ChatGPTAuth?
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
        let authRevision: String
        let provider: String
    }

    init(store: SnapshotStore, state: CompanionState, model: String = "", apiKey: String = "", allowSend: Bool = false,
         chatGPT: ChatGPTAuth? = nil, now: @escaping () -> Date = Date.init, sender: @escaping (Data, String) throws -> String = AICoach.send) {
        self.store = store; self.state = state; self.model = model; self.apiKey = apiKey
        self.chatGPT = chatGPT; self.allowSend = allowSend; self.now = now; self.sender = sender
    }
    private func coachConfiguration() throws -> (model: String, send: Bool, revision: String, provider: String, account: String) {
        if let auth = try chatGPT?.configuration() {
            if auth.mode == "chatgpt" { return (auth.model, auth.ready, auth.revision, "chatgpt", auth.account) }
            return (model, allowSend && !model.isEmpty && !apiKey.isEmpty, auth.revision, "api-key", "Mac API key")
        }
        return (model, allowSend && !model.isEmpty && !apiKey.isEmpty, "api-key", "api-key", "Mac API key")
    }
    var sendEnabled: Bool { (try? coachConfiguration().send) ?? false }
    func capabilities() throws -> Data {
        var result: [String: Any] = ["version": 1, "token": token, "candidates": true, "coachPreview": false, "coachSend": false, "model": ""]
        do {
            let c = try coachConfiguration()
            result["coachPreview"] = !c.model.isEmpty; result["coachSend"] = c.send; result["model"] = c.model
            if let auth = try chatGPT?.status() { result["auth"] = auth }
        } catch { result["authError"] = (error as? CoachError)?.errorDescription ?? "ChatGPT 인증 저장소를 읽지 못했습니다." }
        return try encode(result)
    }
    func oauthCallback(_ target: String) throws {
        guard let chatGPT else { throw CoachError.invalid("ChatGPT 로그인을 지원하지 않는 Companion입니다.") }
        try chatGPT.callback(target)
    }
    func authorized(_ supplied: String?) -> Bool { supplied == token }

    func perform(_ data: Data) throws -> Data {
        guard lock.withLock({ if busy { return false }; busy = true; return true }) else {
            throw CoachError.invalid("다른 요청 처리 중입니다. 완료 후 다시 시도하세요.")
        }
        defer { lock.withLock { busy = false } }
        guard data.count <= 8192, let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let action = input["action"] as? String else { throw CoachError.invalid("요청 형식이 올바르지 않습니다.") }
        if action.hasPrefix("auth-") {
            guard let chatGPT else { throw CoachError.invalid("Companion을 업데이트하세요.") }
            preview = nil
            return try encode(["auth": chatGPT.action(action, input: input)])
        }
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
            let configuration = try coachConfiguration()
            let body = try AICoach.requestBody(snapshot: context.bytes, playerID: player, question: question, model: configuration.model, chatGPT: configuration.provider == "chatgpt")
            let ticket = Preview(id: UUID().uuidString, context: context, body: body, expires: now().addingTimeInterval(120),
                                 authRevision: configuration.revision, provider: configuration.provider)
            preview = ticket
            return try encode(["previewId": ticket.id, "expiresInSeconds": 120, "sendEnabled": configuration.send,
                               "authRevision": ticket.authRevision, "provider": ticket.provider, "account": configuration.account,
                               "request": try JSONSerialization.jsonObject(with: body)])
        case "coach-send":
            guard sendEnabled else { throw CoachError.invalid("ChatGPT 계정·모델을 연결하거나 Mac에서 API 키 방식의 전송을 활성화하세요.") }
            guard let ticket = preview, input["previewId"] as? String == ticket.id else {
                throw CoachError.invalid("유효한 미리보기가 없습니다. 요청 내용을 다시 확인하세요.")
            }
            // Consume before the network call: double clicks, disconnects and retries cannot resend it.
            preview = nil
            guard ticket.expires > now(), ticket.context.matches(context) else {
                throw CoachError.invalid("미리보기가 만료되었거나 세이브가 변경되었습니다. 다시 확인하세요.")
            }
            let configuration = try coachConfiguration()
            guard ticket.authRevision == configuration.revision, ticket.provider == configuration.provider else {
                throw CoachError.invalid("계정·모델·권한이 변경되었습니다. 새 미리보기를 확인하세요.")
            }
            let answer: String
            do {
                if ticket.provider == "chatgpt", let chatGPT { answer = try chatGPT.send(ticket.body, revision: ticket.authRevision) }
                else { answer = try sender(ticket.body, apiKey) }
            } catch {
                if ticket.provider == "chatgpt", let error = error as? CoachError { throw error }
                throw CoachError.invalid("AI 요청이 완료되지 않았습니다. 자동 재전송하지 않습니다. 제공자 사용 내역을 확인한 뒤 새 미리보기로 재시도하세요.") }
            guard let updated = try? current(), context.matches(updated),
                  (try? coachConfiguration().revision) == ticket.authRevision else {
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
