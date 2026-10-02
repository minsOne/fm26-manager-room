import Foundation
import CoreFoundation

enum SnapshotValidationError: LocalizedError {
    case invalid(String)

    var errorDescription: String? {
        switch self {
        case .invalid(let reason):
            return "Snapshot validation failed: \(reason)"
        }
    }
}

/// Structural/range validation for the native snapshot contract.
/// This is not semantic proof that reverse-engineered FM fields are correctly named.
enum SnapshotValidation {
    static func validate(_ data: Data) throws {
        func require(_ condition: Bool, _ reason: String) throws {
            if !condition { throw SnapshotValidationError.invalid(reason) }
        }

        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SnapshotValidationError.invalid("root must be a JSON object")
        }

        try require(integer(root["schemaVersion"], in: 2...2), "unsupported schema version")
        try require(root["source"] as? String == "rust-native", "unexpected data source")
        try require(!(root["saveName"] as? String ?? "").isEmpty, "missing save name")
        try require(validDate(root["gameDate"] as? String), "invalid game date")
        try require(root["coverage"] is [String: Any], "missing coverage")

        guard
            let manager = root["manager"] as? [String: Any],
            let players = root["players"] as? [[String: Any]],
            let fixtures = root["fixtures"] as? [[String: Any]]
        else {
            throw SnapshotValidationError.invalid("missing manager/players/fixtures")
        }

        try require(!(manager["club"] as? String ?? "").isEmpty, "missing managed club")
        try require(integer(manager["clubUid"], in: 1...4_294_967_295), "invalid club UID")
        try require(!players.isEmpty && players.count <= 200_000, "invalid player count")

        if let finance = root["clubFinance"], !(finance is NSNull) {
            guard let row = finance as? [String: Any] else {
                throw SnapshotValidationError.invalid("clubFinance must be an object or null")
            }
            try require(integer(row["balance"], in: -2_147_483_648...2_147_483_647), "invalid club balance")
            for key in ["transferBudgetAllocated", "transferBudgetRemaining"] {
                try require(integer(row[key], in: -2_147_483_648...2_147_483_647), "invalid \(key)")
            }
            for key in ["wageBudgetWeekly", "wagePayrollWeekly", "financeRows"] {
                try require(integer(row[key], in: 0...4_294_967_295), "invalid \(key)")
            }
        }

        var ids = Set<String>()
        for player in players {
            guard
                let id = player["id"] as? String,
                !id.isEmpty,
                ids.insert(id).inserted
            else {
                throw SnapshotValidationError.invalid("missing or repeated player ID")
            }

            try require(integer(player["ca"], in: 0...200), "CA out of range for \(id)")
            try require(integer(player["pa"], in: 0...200), "PA out of range for \(id)")
            try require(player["name"] is String, "missing name for \(id)")
            try require(integer(player["age"], in: 0...150), "invalid age for \(id)")

            guard let positions = player["positions"] as? [String], !positions.isEmpty else {
                throw SnapshotValidationError.invalid("missing positions for \(id)")
            }

            for key in ["attributes", "hidden", "fitness", "playingTime", "contract"] {
                try require(player[key] is [String: Any], "missing \(key) for \(id)")
            }

            if let fitness = player["fitness"] as? [String: Any] {
                try require(integer(fitness["condition"], in: 0...100), "condition out of range for \(id)")
                try require(integer(fitness["matchSharpness"], in: 0...100), "sharpness out of range for \(id)")
            }
            if let playing = player["playingTime"] as? [String: Any] {
                try require(integer(playing["recentMinutes"], in: 0...65_535), "recent minutes invalid for \(id)")
                try require(integer(playing["minutesLast5"], in: 0...65_535), "last-five minutes invalid for \(id)")
            }
        }

        for fixture in fixtures {
            try require(validDate(fixture["date"] as? String), "invalid fixture date")
            try require(!(fixture["opponent"] as? String ?? "").isEmpty, "missing opponent")
            try require(fixture["home"] is Bool, "fixture home flag missing")
        }
    }

    static func validDate(_ value: String?) -> Bool {
        guard let value, value.utf8.count == 10 else { return false }
        let pieces = value.split(separator: "-", omittingEmptySubsequences: false)
        guard
            pieces.count == 3,
            pieces[0].count == 4,
            pieces[1].count == 2,
            pieces[2].count == 2,
            pieces.allSatisfy({ $0.utf8.allSatisfy { (48...57).contains($0) } }),
            let year = Int(pieces[0]),
            (1901...2200).contains(year),
            let month = Int(pieces[1]),
            (1...12).contains(month),
            let day = Int(pieces[2])
        else {
            return false
        }

        let leap = year % 400 == 0 || (year % 4 == 0 && year % 100 != 0)
        let monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return (1...monthDays[month - 1]).contains(day)
    }

    private static func integer(_ value: Any?, in bounds: ClosedRange<Int64>) -> Bool {
        guard
            let number = value as? NSNumber,
            CFGetTypeID(number) != CFBooleanGetTypeID()
        else {
            return false
        }
        let raw = number.doubleValue
        return raw.isFinite
            && raw.rounded() == raw
            && raw >= Double(bounds.lowerBound)
            && raw <= Double(bounds.upperBound)
    }
}
