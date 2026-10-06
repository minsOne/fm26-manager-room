import Foundation
import Network

final class LocalHTTPServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "fm26.manager-room.http")
    private let store: SnapshotStore
    private let companionState: CompanionState
    private let instanceID: String?
    private let policy: LocalRequestPolicy
    private let actions: WebActions

    init(port: UInt16, store: SnapshotStore, companionState: CompanionState, instanceID: String? = nil,
         coachModel: String = "", coachKey: String = "", enableWebCoach: Bool = false) throws {
        self.instanceID = instanceID
        guard port > 0, let endpointPort = NWEndpoint.Port(rawValue: port) else { throw ServerError.invalidPort }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: endpointPort)
        self.listener = try NWListener(using: parameters)
        self.store = store; self.companionState = companionState
        self.policy = LocalRequestPolicy(port: port)
        self.actions = WebActions(store: store, state: companionState, model: coachModel, apiKey: coachKey, allowSend: enableWebCoach)
    }
    func start() {
        listener.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
        listener.stateUpdateHandler = { state in
            if case let .failed(error) = state {
                FileHandle.standardError.write(Data("HTTP server failed: \(error)\n".utf8))
            }
        }
        listener.start(queue: queue)
    }
    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        // Bounded header read and slow-client timeout. Requests may arrive over several packets.
        let timeout = DispatchWorkItem { [weak connection] in connection?.cancel() }
        queue.asyncAfter(deadline: .now() + 5, execute: timeout)
        receiveHeaders(connection, accumulated: Data(), timeout: timeout)
    }
    private func receiveHeaders(_ connection: NWConnection, accumulated: Data, timeout: DispatchWorkItem) {
        let remaining = 16_384 - accumulated.count
        guard remaining > 0 else { reject("431 Request Header Fields Too Large", on: connection); return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: remaining) { [weak self] data, _, complete, error in
            guard let self, error == nil, let data, !data.isEmpty else { connection.cancel(); return }
            var buffer = accumulated; buffer.append(data)
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                guard let text = String(data: buffer[..<end.upperBound], encoding: .utf8) else {
                    self.reject("400 Bad Request", on: connection); return
                }
                let request: LocalRequestPolicy.Request
                do { request = try self.policy.parse(text) }
                catch LocalRequestPolicy.Rejection.forbidden { self.reject("403 Forbidden", on: connection); return }
                catch LocalRequestPolicy.Rejection.methodNotAllowed { self.reject("405 Method Not Allowed", on: connection); return }
                catch { self.reject("400 Bad Request", on: connection); return }
                if request.method == "POST" && !self.actions.authorized(request.actionToken) {
                    self.reject("403 Forbidden", request: request, on: connection); return
                }
                self.receiveBody(connection, request: request, accumulated: Data(buffer[end.upperBound...]), timeout: timeout)
            } else if complete {
                self.reject("400 Bad Request", on: connection)
            } else {
                self.receiveHeaders(connection, accumulated: buffer, timeout: timeout)
            }
        }
    }
    private func receiveBody(_ connection: NWConnection, request: LocalRequestPolicy.Request,
                             accumulated: Data, timeout: DispatchWorkItem) {
        guard accumulated.count <= request.contentLength else { reject("400 Bad Request", request: request, on: connection); return }
        if accumulated.count == request.contentLength {
            timeout.cancel()
            respond(to: request, body: accumulated, on: connection)
            return
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: request.contentLength - accumulated.count + 1) { [weak self] data, _, complete, error in
            guard let self, error == nil, let data, !data.isEmpty else { connection.cancel(); return }
            var body = accumulated; body.append(data)
            if complete && body.count < request.contentLength { self.reject("400 Bad Request", request: request, on: connection); return }
            self.receiveBody(connection, request: request, accumulated: body, timeout: timeout)
        }
    }
    private func respond(to request: LocalRequestPolicy.Request, body: Data, on connection: NWConnection) {
        if request.method == "OPTIONS" {
            send(status: "204 No Content", body: Data(), request: request, on: connection); return
        }
        switch request.path {
        case "/api/actions":
            if request.method == "GET" {
                send(body: (try? actions.capabilities()) ?? Data("{}".utf8), request: request, on: connection)
            } else {
                // Parsing and the bounded provider request must not block health checks or the watcher.
                queue.asyncAfter(deadline: .now() + 135) { [weak connection] in connection?.cancel() }
                DispatchQueue.global(qos: .userInitiated).async { [self] in
                    do { send(body: try actions.perform(body), request: request, on: connection) }
                    catch {
                        let message = (error as? CoachError)?.errorDescription ?? "요청 처리 실패. 연결과 파서 상태를 확인하세요. 자동 재전송하지 않습니다."
                        let data = (try? JSONSerialization.data(withJSONObject: ["error": message])) ?? Data("{}".utf8)
                        send(status: "409 Conflict", body: data, request: request, on: connection)
                    }
                }
            }
        case "/api/health":
            let parser = companionState.snapshot()
            // Runtime probing hashes an executable; do not perform that expensive work on each health poll.
            let value: [String: Any] = [
                "status": "ok", "platform": "macOS", "snapshotAvailable": store.exists,
                "instanceId": instanceID.map { $0 as Any } ?? NSNull(),
                "accessMode": "read-only-save-snapshot", "parsing": parser.parsing,
                "lastParseDurationMs": parser.lastDurationMilliseconds.map { $0 as Any } ?? NSNull(),
                "lastParseError": parser.lastError.map { $0 as Any } ?? NSNull()
            ]
            let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
            send(body: data, request: request, on: connection)
        case "/api/parser":
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            send(body: (try? encoder.encode(companionState.snapshot())) ?? Data("{}".utf8), request: request, on: connection)
        case "/api/runtime":
            send(body: (try? JSONEncoder().encode(FMProcessProbe.probe())) ?? Data("{}".utf8), request: request, on: connection)
        case "/api/snapshot":
            guard let data = try? store.read() else { reject("404 Not Found", request: request, on: connection); return }
            send(body: data, request: request, on: connection)
        default: reject("404 Not Found", request: request, on: connection)
        }
    }
    private func reject(_ status: String, request: LocalRequestPolicy.Request? = nil, on connection: NWConnection) {
        send(status: status, body: Data("{\"error\":\"request rejected\"}".utf8), request: request, on: connection)
    }
    private func send(status: String = "200 OK", body: Data, request: LocalRequestPolicy.Request?, on connection: NWConnection) {
        var headers = ["HTTP/1.1 \(status)", "Content-Type: application/json; charset=utf-8",
            "Content-Length: \(body.count)", "Cache-Control: no-store", "Connection: close",
            "X-Content-Type-Options: nosniff", "Vary: Origin"]
        if let origin = request?.origin {
            headers += ["Access-Control-Allow-Origin: \(origin)",
                        "Access-Control-Allow-Methods: \(request?.path == "/api/actions" ? "GET, POST, OPTIONS" : "GET, OPTIONS")",
                        "Access-Control-Allow-Headers: \(request?.path == "/api/actions" ? "Content-Type, X-Manager-Room-Token" : "Content-Type")"]
            if request?.method == "OPTIONS" && request?.privateNetworkRequested == true {
                headers.append("Access-Control-Allow-Private-Network: true")
            }
        }
        var response = Data((headers.joined(separator: "\r\n") + "\r\n\r\n").utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
    enum ServerError: Error { case invalidPort }
}
