import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

enum NativeParserError: LocalizedError {
    case binaryNotFound([String]), saveNotFound(String), launchFailed(String)
    case parserFailed(Int32, String), invalidJSON, timedOut, outputTooLarge, saveChanged, unsafeDestination
    var errorDescription: String? {
        switch self {
        case .binaryNotFound(let paths): return "Native parser not found: \(paths.joined(separator: ", "))"
        case .saveNotFound(let path): return "Save is not a readable, nonempty regular file: \(path)"
        case .launchFailed(let error): return "Could not launch native parser: \(error)"
        case .parserFailed(let status, let error): return "Parser exited \(status): \(error)"
        case .invalidJSON: return "Parser did not produce a usable Manager Room snapshot."
        case .timedOut: return "Parser timed out; the previous snapshot was retained."
        case .outputTooLarge: return "Parser output exceeded its limit; the previous snapshot was retained."
        case .saveChanged: return "Save changed during import; retry after saving completes."
        case .unsafeDestination: return "Snapshot destination must not be the input save."
        }
    }
}

/// All calls are serialized. Parser input is a private copy, never an mmap of FM's live save.
final class NativeParserRunner: @unchecked Sendable {
    let parserURL: URL
    private let store: SnapshotStore
    private let state: CompanionState
    private let historyStore: DevelopmentHistoryStore?
    private let queue = DispatchQueue(label: "fm26.manager-room.parser", qos: .userInitiated)
    private let parseLock = NSLock()
    private let timeoutSeconds: Double
    private let outputLimit: UInt64
    private let errorLimit: UInt64

    init(parserURL: URL, store: SnapshotStore, state: CompanionState,
         historyStore: DevelopmentHistoryStore? = nil,
         timeoutSeconds: Double = 120, outputLimit: UInt64 = 64 * 1024 * 1024,
         errorLimit: UInt64 = 8 * 1024 * 1024) {
        self.parserURL = parserURL
        self.store = store
        self.state = state
        self.historyStore = historyStore
        self.timeoutSeconds = max(0.05, timeoutSeconds)
        self.outputLimit = outputLimit; self.errorLimit = errorLimit
        state.setParserPath(parserURL.path)
    }

    func parseAsync(saveURL: URL, completion: (@Sendable (Result<Int, Error>) -> Void)? = nil) {
        queue.async { [self] in
            let result = Result { try parse(saveURL: saveURL) }
            completion?(result)
        }
    }

    @discardableResult
    func parse(saveURL: URL) throws -> Int {
        // Also serialize direct CLI calls with watcher calls.
        try parseLock.withLock { try performParse(saveURL: saveURL) }
    }

    private func performParse(saveURL: URL) throws -> Int {
        state.parsingStarted(save: saveURL)
        let started = ContinuousClock.now
        do {
            guard saveURL.resolvingSymlinksInPath().standardizedFileURL != store.url.resolvingSymlinksInPath().standardizedFileURL else {
                throw NativeParserError.unsafeDestination
            }
            let before = try InputSignature(saveURL)
            let fm = FileManager.default
            let work = fm.temporaryDirectory.appendingPathComponent("manager-room-\(UUID().uuidString)", isDirectory: true)
            try fm.createDirectory(at: work, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            defer { try? fm.removeItem(at: work) }
            let staged = work.appendingPathComponent("input.fm")
            try fm.copyItem(at: saveURL, to: staged)
            guard before == (try InputSignature(saveURL)) else { throw NativeParserError.saveChanged }
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: staged.path)

            let outURL = work.appendingPathComponent("stdout.json")
            let errURL = work.appendingPathComponent("stderr.log")
            guard fm.createFile(atPath: outURL.path, contents: nil, attributes: [.posixPermissions: 0o600]),
                  fm.createFile(atPath: errURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                throw NativeParserError.launchFailed("could not create private output files")
            }
            let out = try FileHandle(forWritingTo: outURL)
            let err = try FileHandle(forWritingTo: errURL)
            defer { try? out.close(); try? err.close() }
            let process = Process()
            process.executableURL = parserURL
            process.arguments = ["snapshot", staged.path]
            process.standardInput = FileHandle.nullDevice
            // Files, not sequentially drained pipes: stderr cannot block stdout consumption.
            process.standardOutput = out
            process.standardError = err
            do { try process.run() } catch { throw NativeParserError.launchFailed(error.localizedDescription) }
            let deadline = ContinuousClock.now.advanced(by: .seconds(timeoutSeconds))
            while process.isRunning {
                if ContinuousClock.now >= deadline {
                    stop(process); throw NativeParserError.timedOut
                }
                if fileSize(outURL) > outputLimit || fileSize(errURL) > errorLimit {
                    stop(process); throw NativeParserError.outputTooLarge
                }
                Thread.sleep(forTimeInterval: 0.01)
            }
            process.waitUntilExit()
            guard fileSize(outURL) <= outputLimit && fileSize(errURL) <= errorLimit else {
                throw NativeParserError.outputTooLarge
            }
            guard process.terminationStatus == 0 else {
                let handle = try FileHandle(forReadingFrom: errURL)
                defer { try? handle.close() }
                let data = try handle.read(upToCount: 16_384) ?? Data()
                throw NativeParserError.parserFailed(process.terminationStatus, String(decoding: data, as: UTF8.self))
            }
            let data = try Data(contentsOf: outURL)
            try SnapshotValidation.validate(data)
            guard before == (try InputSignature(saveURL)) else { throw NativeParserError.saveChanged }
            // Atomic replacement only after all gates. Failure never unlinks the last valid snapshot.
            try store.write(data)

            // Development history is derived from a successful validated snapshot only.
            // History failure must not invalidate the current snapshot.
            if let historyStore,
               let selectionId = state.snapshot().selectionId,
               !selectionId.isEmpty {
                do {
                    try historyStore.record(snapshot: data, selectionId: selectionId)
                } catch {
                    FileHandle.standardError.write(Data(
                        "Development history update failed: \(error.localizedDescription)\n".utf8
                    ))
                }
            }

            let elapsed = started.duration(to: .now).components
            let milliseconds = Int(elapsed.seconds * 1_000 + elapsed.attoseconds / 1_000_000_000_000_000)
            state.parsingSucceeded(save: saveURL, durationMilliseconds: milliseconds)
            return milliseconds
        } catch {
            state.parsingFailed(save: saveURL, error: error)
            throw error
        }
    }

    private func stop(_ process: Process) {
        if process.isRunning { process.terminate() }
        let deadline = ContinuousClock.now.advanced(by: .milliseconds(300))
        while process.isRunning && ContinuousClock.now < deadline { Thread.sleep(forTimeInterval: 0.01) }
        if process.isRunning { _ = kill(process.processIdentifier, SIGKILL) }
        process.waitUntilExit()
    }

    static func resolve(explicit: String?) throws -> URL {
        // Explicit configuration must not silently execute a different binary.
        if let path = explicit ?? ProcessInfo.processInfo.environment["FM26_MANAGER_ROOM_PARSER"] {
            let url = URL(fileURLWithPath: path).standardizedFileURL
            guard !path.isEmpty, FileManager.default.isExecutableFile(atPath: url.path) else {
                throw NativeParserError.binaryNotFound([path])
            }
            return url
        }
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let candidates = [executable.deletingLastPathComponent().appendingPathComponent("fm26-manager-room-parser"),
                          cwd.appendingPathComponent("native/fm26-parser/target/release/fm26-manager-room-parser")]
        guard let url = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) else {
            throw NativeParserError.binaryNotFound(candidates.map(\.path))
        }
        return url
    }

    private func fileSize(_ url: URL) -> UInt64 {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.uint64Value ?? 0
    }
}

private struct InputSignature: Equatable {
    let size: UInt64
    let modified: Date
    let inode: UInt64
    init(_ url: URL) throws {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular,
              let n = attrs[.size] as? NSNumber, n.uint64Value > 0,
              let modified = attrs[.modificationDate] as? Date,
              let inode = attrs[.systemFileNumber] as? NSNumber else {
            throw NativeParserError.saveNotFound(url.path)
        }
        self.size = n.uint64Value; self.modified = modified; self.inode = inode.uint64Value
    }
}
