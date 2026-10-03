import Foundation

struct SavedSaveSelection: Codable, Equatable, Sendable {
    let id: String
    let path: String
    let createdAt: Date
}

enum SaveSelectionError: LocalizedError {
    case invalidSave(String)

    var errorDescription: String? {
        switch self {
        case .invalidSave(let path):
            return "Pinned save must be an existing, nonempty .fm file: \(path)"
        }
    }
}

/// Persists the user's explicitly selected career save. It never modifies the save itself.
struct SaveSelectionStore: Sendable {
    let url: URL

    static func defaultStore() -> SaveSelectionStore {
        let base: URL
        if let override = ProcessInfo.processInfo.environment["FM26_MANAGER_ROOM_HOME"], !override.isEmpty {
            base = URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        } else {
            base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("FM26ManagerRoom", isDirectory: true)
        }
        return SaveSelectionStore(url: base.appendingPathComponent("selection.json"))
    }

    func load() -> SavedSaveSelection? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SavedSaveSelection.self, from: data)
    }

    @discardableResult
    func pin(_ saveURL: URL) throws -> SavedSaveSelection {
        let save = saveURL.resolvingSymlinksInPath().standardizedFileURL
        let attrs = try FileManager.default.attributesOfItem(atPath: save.path)
        guard FileManager.default.isReadableFile(atPath: save.path),
              save.pathExtension.lowercased() == "fm",
              attrs[.type] as? FileAttributeType == .typeRegular,
              (attrs[.size] as? NSNumber)?.uint64Value ?? 0 > 0 else {
            throw SaveSelectionError.invalidSave(save.path)
        }

        let existing = load()
        let selection = SavedSaveSelection(
            id: existing?.path == save.path ? existing!.id : UUID().uuidString.lowercased(),
            path: save.path,
            createdAt: existing?.path == save.path ? existing!.createdAt : Date()
        )

        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let data = try JSONEncoder().encode(selection)
        let temporary = url.appendingPathExtension("tmp")
        try data.write(to: temporary, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try FileManager.default.moveItem(at: temporary, to: url)
        return selection
    }

    func clear() throws {
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }
}
