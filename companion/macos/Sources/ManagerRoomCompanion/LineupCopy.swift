import Foundation

/// Runs the source-bound copy writer. It has no process-memory or source-write mode.
enum LineupCopy {
    static var script: URL? {
        let binary = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        return [binary.deletingLastPathComponent().appendingPathComponent("LineupWriter/matchday_lineup_copy.py"),
                source.appendingPathComponent("tools/matchday_lineup_copy.py")]
            .first { FileManager.default.isReadableFile(atPath: $0.path) }
    }
    static func run(mode: String, path: String, parser: String, request: [String: Any]) throws -> [String: Any] {
        guard let script else { throw CoachError.invalid("선발 파일 생성 도구가 없습니다. Companion을 다시 설치하세요.") }
        let fm = FileManager.default
        let work = fm.temporaryDirectory.appendingPathComponent("mr-lineup-action-\(UUID().uuidString)")
        try fm.createDirectory(at: work, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: work) }
        let input = work.appendingPathComponent("request.json")
        try JSONSerialization.data(withJSONObject: request).write(to: input)
        let outURL = work.appendingPathComponent("out.json"), errURL = work.appendingPathComponent("error.txt")
        fm.createFile(atPath: outURL.path, contents: nil)
        fm.createFile(atPath: errURL.path, contents: nil)
        let out = try FileHandle(forWritingTo: outURL), err = try FileHandle(forWritingTo: errURL)
        defer { try? out.close(); try? err.close() }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["python3", "-B", script.path, mode, path, parser, input.path]
        process.environment = ["PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1", "LANG": "en_US.UTF-8"]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = out; process.standardError = err
        try process.run()
        let deadline = Date().addingTimeInterval(300)
        while process.isRunning {
            if Date() > deadline {
                process.terminate(); process.waitUntilExit()
                throw CoachError.invalid("파일 생성 응답이 만료되었습니다. 게임 폴더의 ManagerRoom-Lineup 파일을 확인하세요. 자동 재시도하지 않습니다.")
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let message = String(decoding: try Data(contentsOf: errURL), as: UTF8.self)
            throw CoachError.invalid(String(message.prefix(1200)))
        }
        guard let result = try JSONSerialization.jsonObject(with: Data(contentsOf: outURL)) as? [String: Any] else {
            throw CoachError.invalid("파일 생성 결과를 확인하지 못했습니다.")
        }
        return result
    }
}
