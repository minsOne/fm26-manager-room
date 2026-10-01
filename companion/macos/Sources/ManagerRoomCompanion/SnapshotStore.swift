import Foundation

struct SnapshotStore {
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
        let temporary = url.appendingPathExtension("tmp")
        try data.write(to: temporary, options: .atomic)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try FileManager.default.moveItem(at: temporary, to: url)
    }
}
