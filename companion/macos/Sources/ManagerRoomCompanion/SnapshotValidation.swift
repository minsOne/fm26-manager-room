import Foundation
import CoreFoundation

enum SnapshotValidationError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let reason): return "Snapshot validation failed: \(reason)" }
    }
}

/// Structural/range validation, not a claim that a reverse-engineered field is verified in game.
enum SnapshotValidation {
    static func validate(_ data: Data) throws {
        func require(_ condition: Bool, _ reason: String) throws {
            if !condition { throw SnapshotValidationError.invalid(reason) }
        }
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let meta = root["meta"] as? [String: Any],
              let manager = root["manager"] as? [String: Any],
              let formation = root["formation"] as? [String: Any],
              let slots = formation["slots"] as? [[String: Any]],
              let players = root["players"] as? [[String: Any]],
              let fixtures = root["fixtures"] as? [[String: Any]] else {
            throw SnapshotValidationError.invalid("missing meta/manager/formation/players/fixtures")
        }
        try require(["rust-save-parser", "fmsave"].contains(meta["source"] as? String ?? ""), "unexpected data source")
        try require(validDate(meta["gameDate"] as? String), "invalid game date")
        try require(!(manager["club"] as? String ?? "").isEmpty, "missing managed club")
        try require(integer(manager["clubUid"], in: 1...4_294_967_295), "invalid club UID")
        try require(!slots.isEmpty && slots.count <= 11, "invalid formation size")
        try require(!players.isEmpty && players.count <= 200_000, "invalid player count")
        for key in ["externalCandidates", "loanOffers", "leagues", "training", "recommendationsHistory", "decisions"] {
            try require(root[key] is [Any], "missing \(key) array")
        }
        var ids = Set<String>()
        for player in players {
            guard let id = player["id"] as? String, !id.isEmpty, ids.insert(id).inserted else {
                throw SnapshotValidationError.invalid("missing or repeated player ID")
            }
            try require(integer(player["ca"], in: 0...200), "CA out of range for \(id)")
            try require(integer(player["pa"], in: 0...200), "PA out of range for \(id)")
            try require(player["name"] is String, "missing name for \(id)")
            guard let positions = player["positions"] as? [String], !positions.isEmpty else {
                throw SnapshotValidationError.invalid("missing positions for \(id)")
            }
            for key in ["attributes", "hidden", "fitness", "playingTime", "contract", "market"] {
                try require(player[key] is [String: Any], "missing \(key) for \(id)")
            }
        }
        for fixture in fixtures {
            try require(validDate(fixture["date"] as? String), "invalid fixture date")
            try require(fixture["opponent"] is String, "missing opponent")
        }
    }

    static func validDate(_ value: String?) -> Bool {
        guard let value, value.utf8.count == 10 else { return false }
        let pieces = value.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3, pieces[0].count == 4, pieces[1].count == 2, pieces[2].count == 2,
              pieces.allSatisfy({ $0.utf8.allSatisfy { (48...57).contains($0) } }),
              let y = Int(pieces[0]), (1901...2200).contains(y),
              let m = Int(pieces[1]), (1...12).contains(m), let d = Int(pieces[2]) else { return false }
        let leap = y % 400 == 0 || (y % 4 == 0 && y % 100 != 0)
        return (1...[31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]).contains(d)
    }

    private static func integer(_ value: Any?, in bounds: ClosedRange<Int64>) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
        let n = number.doubleValue
        return n.isFinite && n.rounded() == n && n >= Double(bounds.lowerBound) && n <= Double(bounds.upperBound)
    }
}
