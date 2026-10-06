import Foundation

/// Exact origin + Host checks protect against arbitrary websites and DNS rebinding.
/// This is not authentication against software already running as the local user.
struct LocalRequestPolicy: Sendable {
    let port: UInt16
    struct Request: Sendable {
        let method: String
        let path: String
        let target: String
        let origin: String?
        let privateNetworkRequested: Bool
        let contentLength: Int
        let actionToken: String?
    }
    enum Rejection: Error { case malformed, forbidden, methodNotAllowed }

    func parse(_ text: String) throws -> Request {
        guard text.utf8.count <= 16_384, text.hasSuffix("\r\n\r\n") else { throw Rejection.malformed }
        let lines = text.components(separatedBy: "\r\n")
        let first = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, first[2] == "HTTP/1.1", first[1].hasPrefix("/"), !first[1].hasPrefix("//") else {
            throw Rejection.malformed
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":"), line.first != " ", line.first != "\t" else { throw Rejection.malformed }
            let key = String(line[..<colon]).lowercased()
            guard !key.isEmpty, key.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }),
                  headers[key] == nil else { throw Rejection.malformed }
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { throw Rejection.malformed }
            headers[key] = value
        }
        guard let host = headers["host"], ["127.0.0.1:\(port)", "localhost:\(port)"].contains(host.lowercased()) else {
            throw Rejection.forbidden
        }
        let origin = headers["origin"]
        if let origin, !allowedOrigins.contains(origin) { throw Rejection.forbidden }
        let method = String(first[0])
        let target = String(first[1])
        let path = target.hasPrefix("/auth/callback?") ? "/auth/callback" : target
        if path == "/auth/callback" {
            guard method == "GET", origin == nil, host == "127.0.0.1:\(port)" else { throw Rejection.forbidden }
        }
        let actions = path == "/api/actions"
        guard ["GET", "OPTIONS"].contains(method) || (method == "POST" && actions) else { throw Rejection.methodNotAllowed }
        guard headers["transfer-encoding"] == nil, headers["expect"] == nil else { throw Rejection.malformed }
        let rawLength = headers["content-length"] ?? "0"
        guard !rawLength.isEmpty, rawLength.utf8.allSatisfy({ (48...57).contains($0) }),
              let length = Int(rawLength), length <= 8192 else { throw Rejection.malformed }
        if method == "POST" {
            guard origin != nil, headers["x-manager-room-token"] != nil else { throw Rejection.forbidden }
            guard length > 0, headers["content-type"]?.lowercased() == "application/json" else { throw Rejection.malformed }
        } else if length != 0 { throw Rejection.malformed }
        if let requested = headers["access-control-request-method"], requested != "GET" && !(actions && requested == "POST") {
            throw Rejection.methodNotAllowed
        }
        if let requested = headers["access-control-request-headers"] {
            let permitted = actions ? Set(["content-type", "x-manager-room-token"]) : Set(["content-type"])
            guard requested.lowercased().split(separator: ",").allSatisfy({ permitted.contains($0.trimmingCharacters(in: .whitespaces)) }) else { throw Rejection.forbidden }
        }
        return Request(method: method, path: path, target: target, origin: origin,
                       privateNetworkRequested: headers["access-control-request-private-network"] == "true",
                       contentLength: length, actionToken: headers["x-manager-room-token"])
    }

    var allowedOrigins: Set<String> {
        ["https://minsone.github.io", "http://127.0.0.1:8080", "http://localhost:8080",
         "http://127.0.0.1:\(port)", "http://localhost:\(port)"]
    }
}
