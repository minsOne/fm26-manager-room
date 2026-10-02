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

@main enum CompanionCoreTests {
    static func main() {
        let tests: [(String, () throws -> Void)] = [
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
            ("pinned selection persists and reuses the same identity", {
                try withDirectory { dir in
                    let first = try save(dir)
                    let selectionStore = SaveSelectionStore(url: dir.appendingPathComponent("selection.json"))
                    let a = try selectionStore.pin(first)
                    let b = try selectionStore.pin(first)
                    try check(a.id == b.id)
                    try check(selectionStore.load() == b)
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
