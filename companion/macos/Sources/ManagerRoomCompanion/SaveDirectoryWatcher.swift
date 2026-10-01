import Foundation

struct SaveFileSignature: Equatable, Sendable {
    let path: String
    let size: Int64
    let modificationDate: Date
    let inode: UInt64
}

/// Polling is intentional: a directory vnode does not reliably report in-place file writes.
/// One active import plus the newest stable candidate; never queue every save event.
final class SaveDirectoryWatcher: @unchecked Sendable {
    private let directoryURL: URL
    private let runner: NativeParserRunner
    private let state: CompanionState
    private let queue = DispatchQueue(label: "fm26.manager-room.save-watcher")
    private let isolationKey = DispatchSpecificKey<UInt8>()
    private let debounceSeconds: TimeInterval
    private let pollSeconds: TimeInterval
    private var timer: DispatchSourceTimer?
    private var candidate: SaveFileSignature?
    private var stableSince = ContinuousClock.now
    private var lastParsed: SaveFileSignature?
    private var inFlight = false
    private var retryAfter = ContinuousClock.now

    init(directoryURL: URL, runner: NativeParserRunner, state: CompanionState,
         debounceSeconds: TimeInterval = 1.5, pollSeconds: TimeInterval = 1) {
        self.directoryURL = directoryURL; self.runner = runner; self.state = state
        self.debounceSeconds = max(0.05, debounceSeconds)
        self.pollSeconds = max(0.02, pollSeconds)
        queue.setSpecific(key: isolationKey, value: 1)
        state.setWatchedDirectory(directoryURL.path)
    }
    deinit { stop() }

    func start(parseInitial: Bool = true) throws {
        // Do not create or alter FM's game-data directory on a typo in --save-dir.
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directoryURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw CocoaError(.fileNoSuchFile)
        }
        onQueue {
            guard timer == nil else { return }
            if !parseInitial { lastParsed = newestSaveSignature() }
            let source = DispatchSource.makeTimerSource(queue: queue)
            source.schedule(deadline: .now(), repeating: pollSeconds)
            source.setEventHandler { [weak self] in self?.scan() }
            timer = source
            source.resume()
        }
    }
    func stop() {
        onQueue { timer?.cancel(); timer = nil }
    }
    private func onQueue(_ body: () -> Void) {
        if DispatchQueue.getSpecific(key: isolationKey) != nil { body() }
        else { queue.sync(execute: body) }
    }
    private func scan() {
        guard timer != nil else { return }
        guard let newest = newestSaveSignature() else { candidate = nil; return }
        if candidate != newest {
            candidate = newest; stableSince = .now
        }
        guard newest != lastParsed, !inFlight,
              ContinuousClock.now >= stableSince.advanced(by: .seconds(debounceSeconds)),
              ContinuousClock.now >= retryAfter else { return }
        inFlight = true
        runner.parseAsync(saveURL: URL(fileURLWithPath: newest.path)) { [weak self] result in
            guard let self else { return }
            self.queue.async { [self] in
                inFlight = false
                switch result {
                case .success: lastParsed = newest
                case .failure: retryAfter = .now.advanced(by: .seconds(5))
                }
                scan()
            }
        }
    }
    private func newestSaveSignature() -> SaveFileSignature? {
        guard let urls = try? FileManager.default.contentsOfDirectory(at: directoryURL,
            includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { return nil }
        return urls.compactMap { url -> SaveFileSignature? in
            guard url.pathExtension.lowercased() == "fm",
                  let a = try? FileManager.default.attributesOfItem(atPath: url.path),
                  a[.type] as? FileAttributeType == .typeRegular,
                  let size = a[.size] as? NSNumber, size.int64Value > 0,
                  let modified = a[.modificationDate] as? Date,
                  let inode = a[.systemFileNumber] as? NSNumber else { return nil }
            return SaveFileSignature(path: url.path, size: size.int64Value,
                modificationDate: modified, inode: inode.uint64Value)
        }.max {
            if $0.modificationDate != $1.modificationDate { return $0.modificationDate < $1.modificationDate }
            return $0.path < $1.path
        }
    }
    static func defaultFM26Directory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Sports Interactive", isDirectory: true)
            .appendingPathComponent("Football Manager 26", isDirectory: true)
            .appendingPathComponent("games", isDirectory: true)
    }
}
