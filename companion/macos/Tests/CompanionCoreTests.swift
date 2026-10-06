import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

struct TestFailure: Error { let message: String }
func check(_ value: @autoclosure () -> Bool, _ message: String = "assertion failed") throws {
    if !value() { throw TestFailure(message: message) }
}
func rejects(_ body: () throws -> Void) throws {
    do { try body() } catch { return }
    throw TestFailure(message: "expected rejection")
}
func eventually(_ predicate: () -> Bool, timeout: Double = 3) throws {
    let end = ContinuousClock.now.advanced(by: .seconds(timeout))
    while ContinuousClock.now < end {
        if predicate() { return }
        Thread.sleep(forTimeInterval: 0.02)
    }
    throw TestFailure(message: "condition not reached")
}
func withDirectory(_ body: (URL) throws -> Void) throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("mr-test-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: url) }
    try body(url)
}
func quote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }
func payload() -> [String: Any] {
    [
        "schemaVersion": 2,
        "source": "rust-native",
        "saveName": "Test Career",
        "dbVersion": "26.0.0+0",
        "gameDate": "2037-07-01",
        "manager": ["name": "Manager", "club": "Test FC", "clubUid": 123],
        "clubFinance": NSNull(),
        "fixtures": [],
        "players": [[
            "id": "1",
            "name": "한글 테스트",
            "age": 20,
            "nationality": "1",
            "primaryPosition": "GK",
            "positions": ["GK"],
            "ca": 120,
            "pa": 180,
            "paKnown": true,
            "value": 1_000_000,
            "wage": 10_000,
            "attributes": [:],
            "hidden": [:],
            "playingTime": [
                "agreed": "Squad Player",
                "recentMinutes": 180,
                "startsLast5": 2,
                "minutesLast5": 220,
                "recentMinutesKnown": true
            ],
            "fitness": [
                "condition": 95,
                "matchSharpness": 90,
                "fatigue": 0,
                "fatigueKnown": false,
                "injuryRisk": 0,
                "injuryRiskKnown": false
            ],
            "contract": [
                "weeklyWage": 10_000,
                "monthsRemaining": 24,
                "squadStatus": "Squad Player"
            ]
        ]],
        "coverage": [
            "players": "native",
            "attributes": "native",
            "personality": "native",
            "contracts": "native-chain-current",
            "fixtures": "native-managed-upcoming",
            "recentMinutes": "native-match-history",
            "finances": "managed-club-native-finance"
        ]
    ]
}
func json(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
func parser(_ root: URL, body: String) throws -> URL {
    let url = root.appendingPathComponent("fake-parser.sh")
    try Data(("#!/bin/sh\nset -eu\n" + body + "\n").utf8).write(to: url)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    return url
}
func emitValid() throws -> String {
    "printf '%s' " + quote(String(decoding: try json(payload()), as: UTF8.self))
}
func save(_ root: URL) throws -> URL {
    let url = root.appendingPathComponent("Career 한글.fm")
    try Data("unmodified test input".utf8).write(to: url)
    return url
}
func request(_ origin: String? = nil, host: String = "127.0.0.1:8765", method: String = "GET", extra: String = "") -> String {
    "\(method) /api/snapshot HTTP/1.1\r\nHost: \(host)\r\n" + (origin.map { "Origin: \($0)\r\n" } ?? "") + extra + "\r\n"
}
func webScope(_ selection: String = "pin") -> [String: Any] {
    ["selectionId": selection, "source": "rust-native", "gameDate": "2037-07-01", "dbVersion": "26.0.0+0",
     "build": NSNull(), "clubUid": "123", "managerName": "Manager"]
}
func webInput(_ action: String, _ fields: [String: Any] = [:]) throws -> Data {
    try json(["action": action, "scope": webScope()].merging(fields) { _, new in new })
}
func webContext(_ dir: URL) throws -> (SnapshotStore, CompanionState, URL) {
    let source = try save(dir), store = SnapshotStore(url: dir.appendingPathComponent("snapshot.json")), state = CompanionState()
    try store.write(json(payload())); state.setSelection(id: "pin", path: source.path, mode: "pinned")
    state.parsingSucceeded(save: source, durationMilliseconds: 1)
    return (store, state, source)
}

@main enum CompanionCoreTests {
    static func main() {
        let tests: [(String, () throws -> Void)] = [
            ("ChatGPT OAuth, signed identity, refresh, account isolation and complete streams", { try ChatGPTAuthTests.run() }),
            ("action POST requires exact route, Origin, token, JSON and bounded fixed-length body", {
                let policy = LocalRequestPolicy(port: 8765)
                let good = request("https://minsone.github.io", method: "POST", extra: "Content-Type: application/json\r\nContent-Length: 2\r\nX-Manager-Room-Token: test\r\n")
                    .replacingOccurrences(of: "/api/snapshot", with: "/api/actions")
                let parsed = try policy.parse(good); try check(parsed.contentLength == 2)
                for invalid in [good.replacingOccurrences(of: "Origin: https://minsone.github.io\r\n", with: ""),
                                good.replacingOccurrences(of: "Content-Length: 2", with: "Content-Length: 8193"),
                                good.replacingOccurrences(of: "Content-Length: 2", with: "Content-Length: -2"),
                                good.replacingOccurrences(of: "application/json", with: "text/plain"),
                                good.replacingOccurrences(of: "X-Manager-Room-Token: test\r\n", with: ""),
                                good.replacingOccurrences(of: "Content-Length: 2", with: "Transfer-Encoding: chunked") ] {
                    try rejects { _ = try policy.parse(invalid) }
                }
            }),
            ("web Coach previews without sending, sends exact approved bytes once, never exposes key", {
                try withDirectory { dir in
                    let (store, state, _) = try webContext(dir)
                    var sent = 0, sentBody = Data()
                    let web = WebActions(store: store, state: state, model: "model", apiKey: "private-key", allowSend: true,
                        sender: { data, key in sent += 1; sentBody = data; try check(key == "private-key"); return "Interpretation" })
                    try check(!web.authorized("invalid") && web.authorized(web.token))
                    let capabilities = String(decoding: try web.capabilities(), as: UTF8.self); try check(!capabilities.contains("private-key"))
                    let prepared = try web.perform(webInput("coach-preview", ["playerId": "1", "question": "Explain evidence"]))
                    try check(sent == 0)
                    let preview = try JSONSerialization.jsonObject(with: prepared) as! [String: Any]
                    let approved = preview["request"] as! [String: Any], ticket = preview["previewId"] as! String
                    let answer = try web.perform(webInput("coach-send", ["previewId": ticket]))
                    try check(sent == 1 && String(decoding: answer, as: UTF8.self).contains("Interpretation"))
                    let sentObject = try JSONSerialization.jsonObject(with: sentBody) as! [String: Any]
                    try check(NSDictionary(dictionary: approved).isEqual(to: sentObject))
                    try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket])) }
                    try check(sent == 1)
                }
            }),
            ("web Coach rejects expiration, newer parse, changed career, and consumes failed sends", {
                try withDirectory { dir in
                    let (store, state, source) = try webContext(dir)
                    var clock = Date(), sends = 0
                    let web = WebActions(store: store, state: state, model: "model", apiKey: "key", allowSend: true,
                        now: { clock }, sender: { _, _ in sends += 1; throw CoachError.invalid("private provider error") })
                    func prepare() throws -> String {
                        let response = try JSONSerialization.jsonObject(with: web.perform(webInput("coach-preview", ["playerId": "1", "question": "Q"]))) as! [String: Any]
                        return response["previewId"] as! String
                    }
                    var ticket = try prepare(); clock = clock.addingTimeInterval(121)
                    try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket])) }; try check(sends == 0)
                    ticket = try prepare(); state.parsingSucceeded(save: source, durationMilliseconds: 2)
                    try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket])) }; try check(sends == 0)
                    ticket = try prepare(); state.setSelection(id: "new", path: source.path, mode: "pinned")
                    try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket])) }; try check(sends == 0)
                    state.setSelection(id: "pin", path: source.path, mode: "pinned"); ticket = try prepare()
                    try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket])) }
                    try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket])) }; try check(sends == 1)
                }
            }),
            ("web Coach opt-in is required and parsing/error state blocks local actions", {
                try withDirectory { dir in
                    let (store, state, source) = try webContext(dir)
                    let web = WebActions(store: store, state: state, model: "model", apiKey: "key")
                    try check(!web.sendEnabled)
                    try rejects { _ = try web.perform(webInput("coach-send", ["previewId": "any"])) }
                    state.parsingStarted(save: source)
                    try rejects { _ = try web.perform(webInput("coach-preview", ["playerId": "1", "question": "Q"])) }
                    state.parsingFailed(save: source, error: CoachError.invalid("parse failed"))
                    try rejects { _ = try web.perform(webInput("coach-preview", ["playerId": "1", "question": "Q"])) }
                }
            }),
            ("web candidate page uses private parse, matching live base and stable selection", {
                try withDirectory { dir in
                    let (store, state, _) = try webContext(dir), old = try store.read()
                    let binary = try parser(dir, body: "test \"$1\" = candidates\ntest \"$3\" = query\ntest \"$4\" = 100\n" + emitValid())
                    state.setParserPath(binary.path)
                    let web = WebActions(store: store, state: state)
                    let response = try JSONSerialization.jsonObject(with: web.perform(webInput("candidates", ["query": "query", "offset": "100"]))) as! [String: Any]
                    try check(response["saveId"] as? String == "pin")
                    let unchanged = try store.read(); try check(unchanged == old)
                    var changed = payload(); changed["gameDate"] = "2037-07-02"
                    let stale = try parser(dir, body: "printf '%s' " + quote(String(decoding: try json(changed), as: UTF8.self)))
                    state.setParserPath(stale.path)
                    try rejects { _ = try web.perform(webInput("candidates", ["query": "query", "offset": "100"])) }
                    let stillUnchanged = try store.read(); try check(stillUnchanged == old)
                }
            }),
            ("snapshot valid; absent fixtures supported", { try SnapshotValidation.validate(json(payload())) }),
            ("snapshot rejects empty object and root array", {
                try rejects { try SnapshotValidation.validate(Data("{}".utf8)) }
                try rejects { try SnapshotValidation.validate(Data("[]".utf8)) }
            }),
            ("snapshot rejects duplicate UID", {
                var p = payload(); let players = p["players"] as! [[String: Any]]; p["players"] = players + players
                try rejects { try SnapshotValidation.validate(json(p)) }
            }),
            ("snapshot rejects invalid CA and JSON boolean as number", {
                for invalid: Any in [201, -1, 1.5, true] {
                    var p = payload(); var players = p["players"] as! [[String: Any]]; players[0]["ca"] = invalid; p["players"] = players
                    try rejects { try SnapshotValidation.validate(json(p)) }
                }
            }),
            ("snapshot rejects demo disguised as live", {
                var p = payload(); p["source"] = "demo"
                try rejects { try SnapshotValidation.validate(json(p)) }
            }),
            ("date validation leap years and malformed input", {
                try check(SnapshotValidation.validDate("2000-02-29"))
                for date in ["2100-02-29", "2037-02-29", "2037-13-01", "2037-00-12", "2037-01-00", "2037-1-01"] {
                    try check(!SnapshotValidation.validDate(date), date)
                }
            }),
            ("origin permits only listed browser origins", {
                let policy = LocalRequestPolicy(port: 8765)
                for origin in ["https://minsone.github.io", "http://127.0.0.1:8080", "http://localhost:8080"] {
                    let parsed = try policy.parse(request(origin)); try check(parsed.origin == origin)
                }
                _ = try policy.parse(request()) // Native clients remain usable.
            }),
            ("origin rejects hostile suffix, opaque, arbitrary ports", {
                let policy = LocalRequestPolicy(port: 8765)
                for origin in ["https://evil.example", "https://minsone.github.io.evil.example", "null", "http://localhost:9999", "https://minsone.github.io/path"] {
                    try rejects { _ = try policy.parse(request(origin)) }
                }
            }),
            ("Host rejects DNS rebinding and duplicate headers", {
                let policy = LocalRequestPolicy(port: 8765)
                try rejects { _ = try policy.parse(request(host: "attacker.example:8765")) }
                try rejects { _ = try policy.parse(request(extra: "Host: localhost:8765\r\n")) }
                try rejects { _ = try policy.parse(request("https://minsone.github.io", extra: "Origin: null\r\n")) }
            }),
            ("HTTP refuses writes, bodies and incomplete headers", {
                let policy = LocalRequestPolicy(port: 8765)
                try rejects { _ = try policy.parse(request(method: "POST")) }
                try rejects { _ = try policy.parse(request(extra: "Content-Length: 4\r\n")) }
                try rejects { _ = try policy.parse(request(extra: "Transfer-Encoding: chunked\r\n")) }
                try rejects { _ = try policy.parse("GET /api/snapshot HTTP/1.1\r\nHost: localhost:8765") }
            }),
            ("HTTP parses authorized private-network preflight", {
                let r = try LocalRequestPolicy(port: 8765).parse(request("https://minsone.github.io", method: "OPTIONS",
                    extra: "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Private-Network: true\r\n"))
                try check(r.privateNetworkRequested)
            }),
            ("import uses staged copy; original bytes untouched", {
                try withDirectory { dir in
                    let original = try save(dir), old = try Data(contentsOf: original)
                    let binary = try parser(dir, body: "test \"$2\" != \(quote(original.path))\ncmp -s \"$2\" \(quote(original.path))\n" + emitValid())
                    let store = SnapshotStore(url: dir.appendingPathComponent("snapshot.json")), state = CompanionState()
                    let runner = NativeParserRunner(parserURL: binary, store: store, state: state)
                    _ = try runner.parse(saveURL: original)
                    let now = try Data(contentsOf: original); try check(now == old)
                    try SnapshotValidation.validate(store.read())
                    try check(state.snapshot().lastSuccessAt != nil && !state.snapshot().parsing)
                }
            }),
            ("large stderr does not deadlock stdout", {
                try withDirectory { dir in
                    let original = try save(dir)
                    let binary = try parser(dir, body: "dd if=/dev/zero bs=1024 count=512 >&2 2>/dev/null\n" + emitValid())
                    let runner = NativeParserRunner(parserURL: binary, store: SnapshotStore(url: dir.appendingPathComponent("snapshot.json")), state: CompanionState(), timeoutSeconds: 2)
                    _ = try runner.parse(saveURL: original)
                }
            }),
            ("failure/malformed/invalid snapshots preserve previous good bytes", {
                for body in ["echo bad >&2; exit 7", "printf '{not json'", "printf '{}'", "printf '[]'"] {
                    try withDirectory { dir in
                        let original = try save(dir), state = CompanionState()
                        let store = SnapshotStore(url: dir.appendingPathComponent("snapshot.json"))
                        let old = try json(payload()); try store.write(old)
                        let binary = try parser(dir, body: body)
                        try rejects { _ = try NativeParserRunner(parserURL: binary, store: store, state: state).parse(saveURL: original) }
                        let current = try store.read(); try check(current == old)
                        try check(state.snapshot().lastError != nil && !state.snapshot().parsing)
                    }
                }
            }),
            ("timeout terminates unresponsive parser and preserves snapshot", {
                try withDirectory { dir in
                    let original = try save(dir), store = SnapshotStore(url: dir.appendingPathComponent("snapshot.json"))
                    let old = try json(payload()); try store.write(old)
                    let binary = try parser(dir, body: "trap '' TERM\nwhile :; do :; done")
                    let runner = NativeParserRunner(parserURL: binary, store: store, state: CompanionState(), timeoutSeconds: 0.15)
                    let start = ContinuousClock.now
                    try rejects { _ = try runner.parse(saveURL: original) }
                    let current = try store.read(); try check(current == old)
                    try check(start.duration(to: .now) < .seconds(2))
                }
            }),
            ("oversized stdout and stderr are bounded", {
                for destination in ["", " >&2"] {
                    try withDirectory { dir in
                        let original = try save(dir), store = SnapshotStore(url: dir.appendingPathComponent("snapshot.json"))
                        let old = try json(payload()); try store.write(old)
                        let binary = try parser(dir, body: "dd if=/dev/zero bs=8192 count=1\(destination) 2>/dev/null")
                        let runner = NativeParserRunner(parserURL: binary, store: store, state: CompanionState(), outputLimit: 4096, errorLimit: 4096)
                        try rejects { _ = try runner.parse(saveURL: original) }
                        let current = try store.read(); try check(current == old)
                    }
                }
            }),
            ("source change during import is rejected", {
                try withDirectory { dir in
                    let original = try save(dir), store = SnapshotStore(url: dir.appendingPathComponent("snapshot.json"))
                    let old = try json(payload()); try store.write(old)
                    let binary = try parser(dir, body: "printf change >> \(quote(original.path))\n" + emitValid())
                    try rejects { _ = try NativeParserRunner(parserURL: binary, store: store, state: CompanionState()).parse(saveURL: original) }
                    let current = try store.read(); try check(current == old)
                }
            }),
            ("input cannot be snapshot destination", {
                try withDirectory { dir in
                    let original = try save(dir), old = try Data(contentsOf: original)
                    let binary = try parser(dir, body: emitValid())
                    try rejects { _ = try NativeParserRunner(parserURL: binary, store: SnapshotStore(url: original), state: CompanionState()).parse(saveURL: original) }
                    let current = try Data(contentsOf: original); try check(current == old)
                }
            }),
            ("explicit invalid binary never falls back", {
                try rejects { _ = try NativeParserRunner.resolve(explicit: "/does-not-exist/fm26-parser") }
                try rejects { _ = try NativeParserRunner.resolve(explicit: "") }
            }),
            ("async import executes even without completion closure", {
                try withDirectory { dir in
                    let original = try save(dir), state = CompanionState()
                    let binary = try parser(dir, body: emitValid())
                    let runner = NativeParserRunner(parserURL: binary, store: SnapshotStore(url: dir.appendingPathComponent("snapshot.json")), state: state)
                    runner.parseAsync(saveURL: original)
                    try eventually { state.snapshot().lastSuccessAt != nil }
                }
            }),
            ("watcher detects in-place writes and deduplicates unchanged saves", {
                try withDirectory { dir in
                    let original = try save(dir), state = CompanionState(), counter = dir.appendingPathComponent("calls")
                    let binary = try parser(dir, body: "printf x >> \(quote(counter.path))\n" + emitValid())
                    let runner = NativeParserRunner(parserURL: binary, store: SnapshotStore(url: dir.appendingPathComponent("snapshot.json")), state: state)
                    let watcher = SaveDirectoryWatcher(directoryURL: dir, runner: runner, state: state, debounceSeconds: 0.08, pollSeconds: 0.03)
                    try watcher.start(); defer { watcher.stop() }
                    try eventually { state.snapshot().lastSuccessAt != nil }
                    Thread.sleep(forTimeInterval: 0.2)
                    let first = try Data(contentsOf: counter); try check(first.count == 1)
                    let handle = try FileHandle(forWritingTo: original); try handle.seekToEnd(); try handle.write(contentsOf: Data("updated".utf8)); try handle.close()
                    try eventually { (try? Data(contentsOf: counter).count) == 2 }
                    try eventually { !state.snapshot().parsing }
                    Thread.sleep(forTimeInterval: 0.15)
                    let second = try Data(contentsOf: counter); try check(second.count == 2)
                }
            }),
            ("coach previews only scoped data and rejects incomplete/error outputs", {
                let body = try AICoach.requestBody(snapshot: json(payload()), playerID: "1", question: "Explain role evidence", model: "configured-model")
                let text = String(decoding: body, as: UTF8.self)
                try check(!text.contains("한글 테스트") && !text.contains("Test Career") && !text.contains("weeklyWage"))
                let object = try JSONSerialization.jsonObject(with: body) as! [String: Any]
                try check(object["store"] as? Bool == false)
                try rejects { _ = try AICoach.requestBody(snapshot: json(payload()), playerID: "missing", question: "Q", model: "m") }
                try rejects { _ = try AICoach.requestBody(snapshot: json(payload()), playerID: "1", question: "Q", model: "") }
                let good: [String: Any] = ["status": "completed", "output": [["type": "reasoning"], ["type": "message", "role": "assistant", "content": [["type": "output_text", "text": "근거 확인"]]]]]
                let answer = try AICoach.answer(json(good), status: 200)
                try check(answer == "근거 확인")
                try rejects { _ = try AICoach.answer(json(good), status: 401) }
                try rejects { _ = try AICoach.answer(json(["status": "incomplete", "output": []]), status: 200) }
            }),
            ("pinned selection persists and reuses the same identity", {
                try withDirectory { dir in
                    let first = try save(dir)
                    let selectionStore = SaveSelectionStore(url: dir.appendingPathComponent("selection.json"))
                    let a = try selectionStore.pin(first)
                    let b = try selectionStore.pin(first)
                    try check(a.id == b.id)
                    try check(selectionStore.load() == b)
                    let fresh = try selectionStore.pin(first, newCareer: true)
                    try check(fresh.id != a.id)
                    let retained = try selectionStore.pin(first)
                    try check(retained.id == fresh.id)
                    let second = dir.appendingPathComponent("Other.fm")
                    try Data("other save".utf8).write(to: second)
                    let d = try selectionStore.pin(second)
                    try check(d.id != a.id)
                    try check(d.path == second.resolvingSymlinksInPath().standardizedFileURL.path)
                    try selectionStore.clear()
                    try check(selectionStore.load() == nil)
                }
            }),
            ("pinned watcher ignores newer neighbor saves but tracks in-place writes", {
                try withDirectory { dir in
                    let pinned = try save(dir)
                    let other = dir.appendingPathComponent("Other.fm")
                    try Data("newer neighbor".utf8).write(to: other)
                    try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(120)], ofItemAtPath: other.path)
                    let state = CompanionState(), counter = dir.appendingPathComponent("calls")
                    let binary = try parser(dir, body: "printf x >> \(quote(counter.path))\n" + emitValid())
                    let runner = NativeParserRunner(parserURL: binary, store: SnapshotStore(url: dir.appendingPathComponent("snapshot.json")), state: state)
                    let watcher = SaveDirectoryWatcher(directoryURL: dir, runner: runner, state: state,
                        pinnedSaveURL: pinned, debounceSeconds: 0.08, pollSeconds: 0.03)
                    try watcher.start(); defer { watcher.stop() }
                    try eventually { (try? Data(contentsOf: counter).count) == 1 }
                    try check(state.snapshot().lastSavePath == pinned.resolvingSymlinksInPath().standardizedFileURL.path)

                    let otherHandle = try FileHandle(forWritingTo: other)
                    try otherHandle.seekToEnd(); try otherHandle.write(contentsOf: Data("updated".utf8)); try otherHandle.close()
                    Thread.sleep(forTimeInterval: 0.25)
                    try check((try? Data(contentsOf: counter).count) == 1)

                    let pinnedHandle = try FileHandle(forWritingTo: pinned)
                    try pinnedHandle.seekToEnd(); try pinnedHandle.write(contentsOf: Data("updated".utf8)); try pinnedHandle.close()
                    try eventually { (try? Data(contentsOf: counter).count) == 2 }
                }
            }),
            ("missing watch directory is never created", {
                try withDirectory { dir in
                    let missing = dir.appendingPathComponent("not-created")
                    let state = CompanionState(), binary = try parser(dir, body: emitValid())
                    let runner = NativeParserRunner(parserURL: binary, store: SnapshotStore(url: dir.appendingPathComponent("snapshot.json")), state: state)
                    let watcher = SaveDirectoryWatcher(directoryURL: missing, runner: runner, state: state)
                    try rejects { try watcher.start() }
                    try check(!FileManager.default.fileExists(atPath: missing.path))
                }
            })
        ]
        var failures = 0
        for (name, test) in tests {
            do { try test(); print("PASS \(name)") }
            catch { failures += 1; print("FAIL \(name): \(error)") }
        }
        print("\(tests.count - failures)/\(tests.count) tests passed")
        exit(failures == 0 ? 0 : 1)
    }
}
