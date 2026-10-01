import AppKit
import CryptoKit
import Foundation

struct RuntimeProbe: Codable {
    let running: Bool
    let processIdentifier: Int32?
    let applicationName: String?
    let bundleIdentifier: String?
    let executablePath: String?
    let executableSHA256: String?
    let architecture: String
    let accessMode: String
    let note: String
}

enum FMProcessProbe {
    static func probe() -> RuntimeProbe {
        let app = NSWorkspace.shared.runningApplications.first { app in
            let name = app.localizedName?.lowercased() ?? ""
            let path = app.executableURL?.path.lowercased() ?? ""
            return name.contains("football manager 26")
                || path.contains("football manager 26")
                || app.bundleIdentifier?.lowercased().contains("footballmanager") == true
        }

        guard let app else {
            return RuntimeProbe(
                running: false,
                processIdentifier: nil,
                applicationName: nil,
                bundleIdentifier: nil,
                executablePath: nil,
                executableSHA256: nil,
                architecture: machineArchitecture(),
                accessMode: "bridge-unavailable",
                note: "FM26 is not running. Save parsing and demo mode remain available."
            )
        }

        let executableURL = app.executableURL
        return RuntimeProbe(
            running: true,
            processIdentifier: app.processIdentifier,
            applicationName: app.localizedName,
            bundleIdentifier: app.bundleIdentifier,
            executablePath: executableURL?.path,
            executableSHA256: executableURL.flatMap(sha256),
            architecture: machineArchitecture(),
            accessMode: "in-process-bridge-required",
            note: "macOS external process memory access is intentionally not used. Live FM26 data should come from the BepInEx in-process bridge."
        )
    }

    private static func sha256(_ url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        var hasher = SHA256()
        do {
            while let chunk = try handle.read(upToCount: 4 * 1024 * 1024), !chunk.isEmpty {
                hasher.update(data: chunk)
            }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        } catch {
            return nil
        }
    }

    private static func machineArchitecture() -> String {
        var info = utsname()
        uname(&info)
        let mirror = Mirror(reflecting: info.machine)
        let scalars = mirror.children.compactMap { child -> UnicodeScalar? in
            guard let value = child.value as? Int8, value != 0 else { return nil }
            return UnicodeScalar(UInt8(bitPattern: value))
        }
        return String(String.UnicodeScalarView(scalars))
    }
}
