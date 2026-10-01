import Darwin
import Foundation

struct SaveFileSignature: Equatable, Sendable {
    let path: String
    let size: Int64
    let modificationDate: Date
}

final class SaveDirectoryWatcher: @unchecked Sendable {
    private let directoryURL: URL
    private let runner: NativeParserRunner
    private let state: CompanionState
    private let queue = DispatchQueue(label: "fm26.manager-room.save-watcher")
    private let debounceSeconds: TimeInterval
    private var source: DispatchSourceFileSystemObject?
    private var directoryFD: Int32 = -1
    private var generation = 0
    private var lastParsed: SaveFileSignature?

    init(
        directoryURL: URL,
        runner: NativeParserRunner,
        state: CompanionState,
        debounceSeconds: TimeInterval = 1.5
    ) {
        self.directoryURL = directoryURL
        self.runner = runner
        self.state = state
        self.debounceSeconds = debounceSeconds
        state.setWatchedDirectory(directoryURL.path)
    }

    deinit {
        stop()
    }

    func start(parseInitial: Bool = true) throws {
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )

        directoryFD = open(directoryURL.path, O_EVTONLY)
        guard directoryFD >= 0 else {
            throw CocoaError(.fileReadNoPermission)
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: directoryFD,
            eventMask: [.write, .rename, .delete],
            queue: queue
        )
        source.setEventHandler { [weak self] in
            self?.scheduleScan()
        }
        source.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.directoryFD >= 0 {
                close(self.directoryFD)
                self.directoryFD = -1
            }
        }
        self.source = source
        source.resume()

        if parseInitial {
            scheduleScan(delay: 0.1)
        }
    }

    func stop() {
        source?.cancel()
        source = nil
    }

    private func scheduleScan(delay: TimeInterval? = nil) {
        generation += 1
        let expected = generation
        queue.asyncAfter(deadline: .now() + (delay ?? debounceSeconds)) { [weak self] in
            guard let self, expected == self.generation else { return }
            self.verifyStableCandidate(generation: expected)
        }
    }

    private func verifyStableCandidate(generation expected: Int) {
        guard let first = newestSaveSignature() else { return }

        // A second observation avoids parsing while FM is still replacing/writing the file.
        queue.asyncAfter(deadline: .now() + 0.75) { [weak self] in
            guard let self, expected == self.generation else { return }
            guard let second = self.newestSaveSignature(), first == second else {
                self.scheduleScan()
                return
            }
            guard second != self.lastParsed else { return }

            let saveURL = URL(fileURLWithPath: second.path)
            self.runner.parseAsync(saveURL: saveURL) { [weak self] result in
                guard let self else { return }
                if case .success = result {
                    self.queue.async {
                        self.lastParsed = second
                    }
                }
            }
        }
    }

    private func newestSaveSignature() -> SaveFileSignature? {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        guard
            let urls = try? FileManager.default.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: Array(keys),
                options: [.skipsHiddenFiles]
            )
        else {
            return nil
        }

        return urls.compactMap { url -> SaveFileSignature? in
            guard url.pathExtension.lowercased() == "fm" else { return nil }
            guard let values = try? url.resourceValues(forKeys: keys) else { return nil }
            guard values.isRegularFile == true,
                  let size = values.fileSize,
                  size > 0,
                  let modified = values.contentModificationDate
            else {
                return nil
            }
            return SaveFileSignature(
                path: url.path,
                size: Int64(size),
                modificationDate: modified
            )
        }
        .max { lhs, rhs in lhs.modificationDate < rhs.modificationDate }
    }

    static func defaultFM26Directory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Sports Interactive", isDirectory: true)
            .appendingPathComponent("Football Manager 26", isDirectory: true)
            .appendingPathComponent("games", isDirectory: true)
    }
}
