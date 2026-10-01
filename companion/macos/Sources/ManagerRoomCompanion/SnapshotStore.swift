import Foundation

struct SnapshotStore: Sendable {
    let url: URL

    static func defaultStore() -> SnapshotStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FM26ManagerRoom", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return SnapshotStore(url: base.appendingPathComponent("snapshot.json"))
    }

    var exists: Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    func read() throws -> Data {
        try Data(contentsOf: url)
    }

    func write(_ data: Data) throws {
        try data.write(to: url, options: .atomic)
    }
}
