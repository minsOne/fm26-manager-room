import Foundation
import Darwin

struct CLIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// A PID alone is never sufficient authority to signal a process.
struct ServiceSession: Codable {
    let pid: Int32
    let instanceID: String
    let birth: String
    let port: UInt16
    let executable: String
}

struct ServiceControl {
    let home: URL
    var sessionURL: URL { home.appendingPathComponent("service.json") }
    var logURL: URL { home.appendingPathComponent("companion.log") }

    static var installed: ServiceControl {
        ServiceControl(home: SaveSelectionStore.defaultStore().url.deletingLastPathComponent())
    }

    func withLock<T>(_ body: () throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        let fd = Darwin.open(home.appendingPathComponent("service.lock").path,
                             O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw CLIError(message: "Cannot open service lock in \(home.path). Check permissions.") }
        defer { Darwin.close(fd) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            throw CLIError(message: "Another start/stop/selection command is in progress. Retry after it finishes.")
        }
        defer { flock(fd, LOCK_UN) }
        return try body()
    }

    func load() throws -> ServiceSession? {
        guard FileManager.default.fileExists(atPath: sessionURL.path) else { return nil }
        do { return try JSONDecoder().decode(ServiceSession.self, from: Data(contentsOf: sessionURL)) }
        catch { throw CLIError(message: "Invalid service state: \(sessionURL.path). Inspect the running service before removing this file.") }
    }

    func owns(_ session: ServiceSession) -> Bool {
        guard session.pid > 1,
              processInfo(session.pid, field: "lstart=") == session.birth,
              let command = processInfo(session.pid, field: "command=") else { return false }
        return command.contains(" serve ") && command.contains("--service-instance \(session.instanceID)")
    }

    func processInfo(_ pid: Int32, field: String) -> String? {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-ww", "-p", String(pid), "-o", field]
        process.environment = ProcessInfo.processInfo.environment.merging(["LC_ALL": "C"]) { _, new in new }
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let text = String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return process.terminationStatus == 0 && !text.isEmpty ? text : nil
    }

    func start(arguments: [String], port: UInt16) throws {
        try withLock {
            if let current = try load(), owns(current) {
                guard current.port == port else {
                    throw CLIError(message: "Already running on port \(current.port). Run manager-room stop before changing options.")
                }
                guard LocalDiagnostics.health(port: port)?["instanceId"] as? String == current.instanceID else {
                    throw CLIError(message: "Managed process exists but its API is unavailable. Inspect \(logURL.path), then stop and restart.")
                }
                print("Manager Room already running at http://127.0.0.1:\(port). Stop before changing save/parser options.")
                if !arguments.contains("--no-open") { openManagerRoomWeb(port: port) }
                return
            }
            guard LocalDiagnostics.portAvailable(port) else {
                throw CLIError(message: "Port \(port) is occupied. Stop the owning service or choose --port. No process was terminated.")
            }
            let explicitSave = option("--save", in: arguments)
            let pinned = SaveSelectionStore.defaultStore().load()
            guard explicitSave != nil || option("--save-dir", in: arguments) != nil || pinned != nil else {
                throw CLIError(message: "Choose a career first: manager-room select-save")
            }
            if let path = explicitSave ?? (option("--save-dir", in: arguments) == nil ? pinned?.path : nil) {
                guard FileManager.default.isReadableFile(atPath: path) else {
                    throw CLIError(message: "Save is not readable: \(path). Re-select it or grant Terminal access in System Settings → Privacy & Security.")
                }
            }
            _ = try NativeParserRunner.resolve(explicit: option("--parser", in: arguments))
            let executable = Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
            let instance = UUID().uuidString.lowercased()
            let childArguments = Array(arguments.dropFirst()).filter { $0 != "--no-open" && $0 != "--open-web" }
            // Rotate between launches; parser stdout is bounded by NativeParserRunner.
            if let size = try? FileManager.default.attributesOfItem(atPath: logURL.path)[.size] as? NSNumber,
               size.intValue > 5 * 1024 * 1024 {
                let old = home.appendingPathComponent("companion.previous.log")
                try? FileManager.default.removeItem(at: old)
                try FileManager.default.moveItem(at: logURL, to: old)
            }
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            let log = try FileHandle(forWritingTo: logURL)
            defer { try? log.close() }
            try log.seekToEnd()
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/nohup")
            process.arguments = [executable.path, "serve"] + childArguments + ["--service-instance", instance]
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = log
            process.standardError = log
            try process.run()
            var recorded = false
            do {
                let birthDeadline = Date().addingTimeInterval(3)
                var birth: String?
                repeat {
                    birth = processInfo(process.processIdentifier, field: "lstart=")
                    if birth == nil { Thread.sleep(forTimeInterval: 0.05) }
                } while birth == nil && process.isRunning && Date() < birthDeadline
                guard let birth else { throw CLIError(message: "Service exited before startup. See \(logURL.path).") }
                let session = ServiceSession(pid: process.processIdentifier, instanceID: instance,
                                             birth: birth, port: port, executable: executable.path)
                try JSONEncoder().encode(session).write(to: sessionURL, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: sessionURL.path)
                recorded = true
                let deadline = Date().addingTimeInterval(135)
                var parserState: [String: Any]?
                while process.isRunning && Date() < deadline {
                    if LocalDiagnostics.health(port: port)?["instanceId"] as? String == instance {
                        parserState = LocalDiagnostics.json(path: "/api/parser", port: port)
                        if let error = parserState?["lastError"] as? String {
                            throw CLIError(message: "Initial parse failed: \(error). Previous snapshot retained. See \(logURL.path).")
                        }
                        // A pinned/explicit career must finish its first real parse before opening the browser.
                        if parserState?["lastSuccessAt"] != nil { break }
                    }
                    Thread.sleep(forTimeInterval: 0.1)
                }
                guard process.isRunning, parserState?["lastSuccessAt"] != nil else {
                    throw CLIError(message: "Startup/first parse did not complete. See \(logURL.path).")
                }
                print("Manager Room connected — http://127.0.0.1:\(port)")
                if let path = parserState?["selectedSavePath"] as? String { print("Pinned Save: \(URL(fileURLWithPath: path).lastPathComponent)") }
                print("Last Sync: \(parserState?["lastSuccessAt"] as? String ?? "Unknown")")
                print("Log: \(logURL.path)\nStop: manager-room stop")
                if !arguments.contains("--no-open") { openManagerRoomWeb(port: port) }
            } catch {
                if process.isRunning { process.terminate(); process.waitUntilExit() }
                if recorded { try? FileManager.default.removeItem(at: sessionURL) }
                throw error
            }
        }
    }

    func stop() throws {
        try withLock {
            guard let session = try load() else { print("Manager Room is stopped."); return }
            guard owns(session) else {
                try FileManager.default.removeItem(at: sessionURL)
                print("Removed stale service state. No process was signalled.")
                return
            }
            guard Darwin.kill(session.pid, SIGTERM) == 0 else { throw CLIError(message: "Could not stop managed service. Check process permissions.") }
            let deadline = Date().addingTimeInterval(10)
            while owns(session) && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
            guard !owns(session) else { throw CLIError(message: "Service did not stop. State retained; inspect \(logURL.path).") }
            try FileManager.default.removeItem(at: sessionURL)
            print("Manager Room stopped.")
        }
    }

    func requireStopped() throws {
        if let session = try load(), owns(session) {
            throw CLIError(message: "Stop Manager Room before changing the selected career: manager-room stop")
        }
    }
}
