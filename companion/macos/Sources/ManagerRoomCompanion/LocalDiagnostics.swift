import Foundation
import Darwin

/// Small bounded probes, with no Python/Homebrew dependency on the user's Mac.
enum LocalDiagnostics {
    static var architecture: String {
        var info = utsname()
        uname(&info)
        let machine = Mirror(reflecting: info.machine).children.compactMap { child -> UnicodeScalar? in
            guard let value = child.value as? Int8, value != 0 else { return nil }
            return UnicodeScalar(UInt8(bitPattern: value))
        }
        var arm: Int32 = 0
        var size = MemoryLayout<Int32>.size
        sysctlbyname("hw.optional.arm64", &arm, &size, nil, 0)
        return String(String.UnicodeScalarView(machine)) + (arm == 1 ? " (Apple Silicon)" : " (Intel)")
    }

    static func json(path: String, port: UInt16) -> [String: Any]? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mr-http-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
        defer { try? FileManager.default.removeItem(at: url) }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        process.arguments = ["--silent", "--fail", "--noproxy", "*", "--max-time", "2", "--max-filesize", "65536",
                             "--output", url.path, "http://127.0.0.1:\(port)\(path)"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run(); process.waitUntilExit() } catch { return nil }
        guard process.terminationStatus == 0, let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func health(port: UInt16) -> [String: Any]? {
        guard let value = json(path: "/api/health", port: port),
              value["status"] as? String == "ok", value["platform"] as? String == "macOS",
              value["accessMode"] as? String == "read-only-save-snapshot" else { return nil }
        return value
    }

    static func portAvailable(_ port: UInt16) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { Darwin.close(fd) }
        // Match listener restart behavior: TIME_WAIT connections are not a live listener.
        var reuse: Int32 = 1
        guard setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size)) == 0 else { return false }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }

    static func webReachable() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        process.arguments = ["--silent", "--fail", "--head", "--max-time", "5", "https://minsone.github.io/fm26-manager-room/"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run(); process.waitUntilExit(); return process.terminationStatus == 0 } catch { return false }
    }

    static func snapshotWritable(_ store: SnapshotStore) -> Bool {
        let probe = store.url.deletingLastPathComponent().appendingPathComponent(".doctor-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: probe) }
        do { try Data("probe".utf8).write(to: probe, options: .withoutOverwriting); return true } catch { return false }
    }
}
