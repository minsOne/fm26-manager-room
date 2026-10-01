import Foundation
import Network

final class LocalHTTPServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "fm26.manager-room.http")
    private let store: SnapshotStore

    init(port: UInt16, store: SnapshotStore) throws {
        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            throw ServerError.invalidPort
        }
        self.listener = try NWListener(using: .tcp, on: endpointPort)
        self.store = store
    }

    func start() {
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.stateUpdateHandler = { state in
            if case let .failed(error) = state {
                fputs("HTTP server failed: \(error)\n", stderr)
            }
        }
        listener.start(queue: queue)
    }

    private func handle(_ connection: NWConnection) {
        guard isLoopback(connection.endpoint) else {
            connection.cancel()
            return
        }

        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, _, _ in
            guard let self, let data, let request = String(data: data, encoding: .utf8) else {
                connection.cancel()
                return
            }
            self.respond(to: request, on: connection)
        }
    }

    private func respond(to request: String, on connection: NWConnection) {
        let firstLine = request.split(separator: "\r\n", maxSplits: 1).first.map(String.init) ?? ""
        let parts = firstLine.split(separator: " ")
        let method = parts.first.map(String.init) ?? ""
        let path = parts.dropFirst().first.map(String.init) ?? "/"

        if method == "OPTIONS" {
            send(status: "204 No Content", type: "text/plain", body: Data(), on: connection)
            return
        }

        guard method == "GET" else {
            sendJSON(status: "405 Method Not Allowed", value: ["error": "read-only companion"], on: connection)
            return
        }

        switch path {
        case "/api/health":
            let probe = FMProcessProbe.probe()
            let value: [String: Any] = [
                "status": "ok",
                "platform": "macOS",
                "snapshotAvailable": store.exists,
                "fmRunning": probe.running,
                "accessMode": probe.accessMode
            ]
            sendJSON(status: "200 OK", value: value, on: connection)

        case "/api/runtime":
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = (try? encoder.encode(FMProcessProbe.probe())) ?? Data("{}".utf8)
            send(status: "200 OK", type: "application/json; charset=utf-8", body: data, on: connection)

        case "/api/snapshot":
            guard store.exists, let data = try? store.read() else {
                sendJSON(status: "404 Not Found", value: ["error": "snapshot unavailable"], on: connection)
                return
            }
            send(status: "200 OK", type: "application/json; charset=utf-8", body: data, on: connection)

        default:
            sendJSON(status: "404 Not Found", value: ["error": "not found"], on: connection)
        }
    }

    private func sendJSON(status: String, value: [String: Any], on connection: NWConnection) {
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
        send(status: status, type: "application/json; charset=utf-8", body: data, on: connection)
    }

    private func send(status: String, type: String, body: Data, on connection: NWConnection) {
        let headers = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(type)",
            "Content-Length: \(body.count)",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type",
            "Cache-Control: no-store",
            "Connection: close",
            "",
            ""
        ].joined(separator: "\r\n")

        var response = Data(headers.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func isLoopback(_ endpoint: NWEndpoint) -> Bool {
        guard case let .hostPort(host, _) = endpoint else { return false }
        let value = String(describing: host).lowercased()
        return value == "127.0.0.1" || value == "::1" || value == "localhost"
    }

    enum ServerError: Error {
        case invalidPort
    }
}
