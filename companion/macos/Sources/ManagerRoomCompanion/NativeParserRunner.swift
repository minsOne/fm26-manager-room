import Foundation

enum NativeParserError: LocalizedError {
    case binaryNotFound([String])
    case saveNotFound(String)
    case launchFailed(String)
    case parserFailed(Int32, String)
    case invalidJSON

    var errorDescription: String? {
        switch self {
        case let .binaryNotFound(paths):
            "Native parser binary was not found. Tried: \(paths.joined(separator: ", "))"
        case let .saveNotFound(path):
            "FM26 save does not exist: \(path)"
        case let .launchFailed(message):
            "Could not launch native parser: \(message)"
        case let .parserFailed(status, stderr):
            "Native parser exited with status \(status): \(stderr)"
        case .invalidJSON:
            "Native parser output is not valid JSON."
        }
    }
}

final class NativeParserRunner: @unchecked Sendable {
    let parserURL: URL
    private let store: SnapshotStore
    private let state: CompanionState
    private let queue = DispatchQueue(label: "fm26.manager-room.parser", qos: .userInitiated)

    init(parserURL: URL, store: SnapshotStore, state: CompanionState) {
        self.parserURL = parserURL
        self.store = store
        self.state = state
        state.setParserPath(parserURL.path)
    }

    func parseAsync(
        saveURL: URL,
        completion: (@Sendable (Result<Int, Error>) -> Void)? = nil
    ) {
        queue.async { [self] in
            let result = Result { try parse(saveURL: saveURL) }
            completion?(result)
        }
    }

    @discardableResult
    func parse(saveURL: URL) throws -> Int {
        guard FileManager.default.fileExists(atPath: saveURL.path) else {
            throw NativeParserError.saveNotFound(saveURL.path)
        }

        state.parsingStarted(save: saveURL)
        let started = ContinuousClock.now

        do {
            let process = Process()
            process.executableURL = parserURL
            process.arguments = ["snapshot", saveURL.path]

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr
            process.standardInput = FileHandle.nullDevice

            do {
                try process.run()
            } catch {
                throw NativeParserError.launchFailed(String(describing: error))
            }

            let data = stdout.fileHandleForReading.readDataToEndOfFile()
            let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else {
                let message = String(data: errorData, encoding: .utf8) ?? "unknown parser error"
                throw NativeParserError.parserFailed(
                    process.terminationStatus,
                    message.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }

            guard
                let object = try? JSONSerialization.jsonObject(with: data),
                JSONSerialization.isValidJSONObject(object)
            else {
                throw NativeParserError.invalidJSON
            }

            try store.write(data)

            let elapsed = started.duration(to: .now)
            let milliseconds = Int(elapsed.components.seconds * 1_000)
                + Int(elapsed.components.attoseconds / 1_000_000_000_000_000)

            state.parsingSucceeded(save: saveURL, durationMilliseconds: milliseconds)
            return milliseconds
        } catch {
            state.parsingFailed(save: saveURL, error: error)
            throw error
        }
    }

    static func resolve(explicit: String?) throws -> URL {
        var candidates: [URL] = []

        if let explicit, !explicit.isEmpty {
            candidates.append(URL(fileURLWithPath: explicit).standardizedFileURL)
        }

        if let environment = ProcessInfo.processInfo.environment["FM26_MANAGER_ROOM_PARSER"],
           !environment.isEmpty {
            candidates.append(URL(fileURLWithPath: environment).standardizedFileURL)
        }

        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
        candidates.append(
            executable
                .deletingLastPathComponent()
                .appendingPathComponent("fm26-manager-room-parser")
        )

        let cwd = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
        candidates.append(
            cwd.appendingPathComponent(
                "native/fm26-parser/target/release/fm26-manager-room-parser"
            )
        )

        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate.path) {
            return candidate
        }

        throw NativeParserError.binaryNotFound(candidates.map(\.path))
    }
}
