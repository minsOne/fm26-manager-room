import Foundation

struct ParserStateSnapshot: Codable {
    let parsing: Bool
    let lastSuccessAt: Date?
    let lastDurationMilliseconds: Int?
    let lastSavePath: String?
    let lastError: String?
    let parserPath: String?
    let watchedDirectory: String?
}

final class CompanionState: @unchecked Sendable {
    private let lock = NSLock()

    private var parsing = false
    private var lastSuccessAt: Date?
    private var lastDurationMilliseconds: Int?
    private var lastSavePath: String?
    private var lastError: String?
    private var parserPath: String?
    private var watchedDirectory: String?

    func setParserPath(_ path: String?) {
        lock.withLock { parserPath = path }
    }

    func setWatchedDirectory(_ path: String?) {
        lock.withLock { watchedDirectory = path }
    }

    func parsingStarted(save: URL) {
        lock.withLock {
            parsing = true
            lastSavePath = save.path
            lastError = nil
        }
    }

    func parsingSucceeded(save: URL, durationMilliseconds: Int) {
        lock.withLock {
            parsing = false
            lastSavePath = save.path
            lastDurationMilliseconds = durationMilliseconds
            lastSuccessAt = Date()
            lastError = nil
        }
    }

    func parsingFailed(save: URL?, error: Error) {
        lock.withLock {
            parsing = false
            if let save {
                lastSavePath = save.path
            }
            lastError = String(describing: error)
        }
    }

    func snapshot() -> ParserStateSnapshot {
        lock.withLock {
            ParserStateSnapshot(
                parsing: parsing,
                lastSuccessAt: lastSuccessAt,
                lastDurationMilliseconds: lastDurationMilliseconds,
                lastSavePath: lastSavePath,
                lastError: lastError,
                parserPath: parserPath,
                watchedDirectory: watchedDirectory
            )
        }
    }
}
