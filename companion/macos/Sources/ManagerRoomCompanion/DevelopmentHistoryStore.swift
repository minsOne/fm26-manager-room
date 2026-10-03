import Foundation

struct DevelopmentHistoryPlayer: Codable, Equatable, Sendable {
    let id: String
    let ca: Int
    let pa: Int?
    let value: Int?
    let attributes: [String: Int]
}

struct DevelopmentHistoryPoint: Codable, Equatable, Sendable {
    let gameDate: String
    let recordedAt: Date
    let players: [DevelopmentHistoryPlayer]
}

struct DevelopmentHistoryDocument: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let selectionId: String
    var points: [DevelopmentHistoryPoint]
}

enum DevelopmentHistoryError: LocalizedError {
    case invalidSelectionId
    case invalidSnapshot

    var errorDescription: String? {
        switch self {
        case .invalidSelectionId:
            return "Development history selection ID is invalid."
        case .invalidSnapshot:
            return "Snapshot cannot be converted into a development history point."
        }
    }
}

/// Local read-only history derived from already validated snapshots.
/// One file is kept per pinned selection ID so different careers cannot mix.
struct DevelopmentHistoryStore: Sendable {
    let directoryURL: URL
    let maxPoints: Int

    init(directoryURL: URL, maxPoints: Int = 400) {
        self.directoryURL = directoryURL
        self.maxPoints = max(2, maxPoints)
    }

    static func defaultStore() -> DevelopmentHistoryStore {
        let base: URL
        if let override = ProcessInfo.processInfo.environment["FM26_MANAGER_ROOM_HOME"], !override.isEmpty {
            base = URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        } else {
            base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("FM26ManagerRoom", isDirectory: true)
        }
        return DevelopmentHistoryStore(directoryURL: base.appendingPathComponent("history", isDirectory: true))
    }

    func record(snapshot data: Data, selectionId: String, now: Date = Date()) throws {
        let url = try fileURL(selectionId: selectionId)
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let gameDate = root["gameDate"] as? String,
            !gameDate.isEmpty,
            let rows = root["players"] as? [[String: Any]]
        else {
            throw DevelopmentHistoryError.invalidSnapshot
        }

        var players: [DevelopmentHistoryPlayer] = []
        players.reserveCapacity(rows.count)
        for row in rows {
            guard
                let id = row["id"] as? String,
                !id.isEmpty,
                let caNumber = row["ca"] as? NSNumber
            else { continue }

            let ca = caNumber.intValue
            guard (0...200).contains(ca) else { continue }

            let paKnown = row["paKnown"] as? Bool == true
            let paValue = (row["pa"] as? NSNumber)?.intValue
            let pa = paKnown && paValue.map({ (0...200).contains($0) }) == true ? paValue : nil

            let valueKnown = row["valueKnown"] as? Bool == true
            let valueNumber = (row["value"] as? NSNumber)?.intValue
            let value = valueKnown && valueNumber.map({ $0 >= 0 }) == true ? valueNumber : nil

            let rawAttributes = row["attributes"] as? [String: Any] ?? [:]
            let attributes = rawAttributes.reduce(into: [String: Int]()) { result, entry in
                guard
                    entry.key.range(of: #"^[A-Za-z][A-Za-z0-9]*$"#, options: .regularExpression) != nil,
                    let value = entry.value as? NSNumber,
                    (1...20).contains(value.intValue)
                else { return }
                result[entry.key] = value.intValue
            }

            players.append(DevelopmentHistoryPlayer(
                id: id,
                ca: ca,
                pa: pa,
                value: value,
                attributes: attributes
            ))
        }

        guard !players.isEmpty else { throw DevelopmentHistoryError.invalidSnapshot }
        players.sort { numericAware($0.id, $1.id) }

        var document = (try? load(selectionId: selectionId))
            ?? DevelopmentHistoryDocument(schemaVersion: 1, selectionId: selectionId, points: [])

        let point = DevelopmentHistoryPoint(
            gameDate: gameDate,
            recordedAt: now,
            players: players
        )

        // One canonical observation per in-game date. Re-saving that date replaces it.
        document.points.removeAll { $0.gameDate == gameDate }
        document.points.append(point)
        document.points.sort {
            $0.gameDate == $1.gameDate
                ? $0.recordedAt < $1.recordedAt
                : $0.gameDate < $1.gameDate
        }
        if document.points.count > maxPoints {
            document.points.removeFirst(document.points.count - maxPoints)
        }

        try write(document, to: url)
    }

    func load(selectionId: String) throws -> DevelopmentHistoryDocument? {
        let url = try fileURL(selectionId: selectionId)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let document = try decoder.decode(DevelopmentHistoryDocument.self, from: data)
        guard document.schemaVersion == 1, document.selectionId == selectionId else {
            throw DevelopmentHistoryError.invalidSnapshot
        }
        return document
    }

    func read(selectionId: String) throws -> Data {
        let document = try load(selectionId: selectionId)
            ?? DevelopmentHistoryDocument(schemaVersion: 1, selectionId: selectionId, points: [])
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(document)
    }

    private func fileURL(selectionId: String) throws -> URL {
        guard selectionId.range(of: #"^[a-zA-Z0-9-]{1,80}$"#, options: .regularExpression) != nil else {
            throw DevelopmentHistoryError.invalidSelectionId
        }
        return directoryURL.appendingPathComponent(selectionId).appendingPathExtension("json")
    }

    private func write(_ document: DevelopmentHistoryDocument, to url: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(document)
        let temporary = url.appendingPathExtension("tmp")
        try data.write(to: temporary, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        if fm.fileExists(atPath: url.path) {
            try fm.removeItem(at: url)
        }
        try fm.moveItem(at: temporary, to: url)
    }
}

private func numericAware(_ lhs: String, _ rhs: String) -> Bool {
    if let l = UInt64(lhs), let r = UInt64(rhs) { return l < r }
    return lhs < rhs
}
