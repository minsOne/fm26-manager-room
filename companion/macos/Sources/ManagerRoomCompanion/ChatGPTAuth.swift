import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(AppKit)
import AppKit
#endif

/// One Companion owns the browser callback. Keychain updates/refreshes are serialized across processes.
final class ChatGPTAuth: @unchecked Sendable {
    struct Credentials: Codable {
        var access: String; var refresh: String?; var idToken: String
        var scopes: [String]; var expires: Date
    }
    struct Profile: Codable {
        var client: String; var subject: String?; var email: String?
        var credentials: Credentials?; var model: String = ""
    }
    struct Saved: Codable {
        var host = "urn:uuid:\(UUID().uuidString.lowercased())"
        var revision = "signed-out"
        var mode = "api-key"
        var active: String?
        var profiles: [Profile] = []
        mutating func changed() { revision = UUID().uuidString }
    }
    struct Model { let slug: String; let name: String }
    struct Configuration {
        let revision: String; let mode: String; let model: String; let ready: Bool; let account: String
    }
    private struct Attempt {
        let state: String; let nonce: String; let verifier: String; let client: String?
        let redirect: String; let expires: Date; let revision: String
    }
    private let vault: ChatGPTVault
    private let transport: OpenAIHTTP.Transport
    private let clock: () -> Date
    private let random: () throws -> String
    private let verify: (String, Data, String, String?, Date) throws -> [String: Any]
    private let openBrowser: (URL) -> Void
    private let redirect: String
    private let lock = NSRecursiveLock()
    private var pending: Attempt?
    private var catalogs: [String: [Model]] = [:]
    private var message = ""
    private static let resource = "https://api.openai.com/v1"
    private static let tokenURL = "https://auth.openai.com/api/accounts/oauth/token"
    private static let direct = "chatgpt.tokens.use.direct"

    init(port: UInt16, vault: ChatGPTVault = .keychain(), transport: @escaping OpenAIHTTP.Transport = OpenAIHTTP.perform,
         clock: @escaping () -> Date = Date.init, random: @escaping () throws -> String = ChatGPTSecurity.random,
         verify: @escaping (String, Data, String, String?, Date) throws -> [String: Any] = ChatGPTSecurity.identity,
         openBrowser: @escaping (URL) -> Void = ChatGPTAuth.openSystemBrowser) {
        self.redirect = "http://127.0.0.1:\(port)/auth/callback"
        self.vault = vault; self.transport = transport; self.clock = clock; self.random = random
        self.verify = verify; self.openBrowser = openBrowser
    }
    static func openSystemBrowser(_ url: URL) {
        #if canImport(AppKit)
        DispatchQueue.main.async { NSWorkspace.shared.open(url) }
        #endif
    }
    private func withSaved<T>(_ body: (inout Saved) throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        return try vault.transaction {
            var saved = Saved()
            if let data = try vault.read() {
                guard data.count <= 1_048_576 else { throw CoachError.invalid("ChatGPT 인증 저장소 크기 오류.") }
                saved = try JSONDecoder().decode(Saved.self, from: data)
            }
            if let attempt = pending, attempt.expires <= clock() || attempt.revision != saved.revision {
                pending = nil; message = "로그인이 만료되었거나 다른 창에서 인증 설정이 변경되었습니다. 다시 로그인하세요."
            }
            return try body(&saved)
        }
    }
    private func persist(_ saved: Saved) throws { try vault.write(JSONEncoder().encode(saved)) }
    private func config(_ saved: Saved) -> Configuration {
        let profile = saved.profiles.first { $0.client == saved.active }
        let model = profile.flatMap { p in catalogs[p.client]?.first { $0.slug == p.model }?.slug } ?? ""
        let granted = profile?.credentials?.scopes.contains(Self.direct) == true
        return Configuration(revision: saved.revision, mode: saved.mode, model: model,
            ready: pending == nil && granted && !model.isEmpty,
            account: profile.map { p in "\(p.email ?? "ChatGPT 계정") · 연결 \((saved.profiles.firstIndex(where: { $0.client == p.client }) ?? 0) + 1)" } ?? "")
    }
    func configuration() throws -> Configuration { try withSaved { config($0) } }
    private func status(_ saved: Saved) -> [String: Any] {
        let c = config(saved)
        let profile = saved.profiles.first { $0.client == saved.active }
        let profiles: [[String: Any]] = saved.profiles.enumerated().map { index, p in
            ["id": p.client, "label": "\(p.email ?? "ChatGPT 계정") · 연결 \(index + 1)", "connected": p.credentials != nil]
        }
        return ["revision": c.revision, "mode": c.mode, "profiles": profiles, "active": saved.active ?? "",
                "pending": pending != nil, "connected": profile?.credentials != nil,
                "planEnabled": profile?.credentials?.scopes.contains(Self.direct) == true,
                "ready": c.ready, "model": c.model, "message": message,
                "models": (catalogs[saved.active ?? ""] ?? []).map { ["slug": $0.slug, "name": $0.name] }]
    }
    func status() throws -> [String: Any] { try withSaved { status($0) } }

    func action(_ name: String, input: [String: Any]) throws -> [String: Any] {
        try withSaved { saved in
            switch name {
            case "auth-login":
                guard saved.profiles.count < 20 || input["profileId"] as? String != nil else { throw CoachError.invalid("최대 20개 ChatGPT 연결을 지원합니다.") }
                let client = input["profileId"] as? String
                let selected = saved.profiles.first { $0.client == client }
                guard client == nil || selected != nil else { throw CoachError.invalid("저장된 ChatGPT 연결을 선택하세요.") }
                let verifier = try random(), state = try random(), nonce = try random()
                var query = ["client_id": client ?? "dynamic_agent_client", "ext_agent_host_id": saved.host,
                    "response_type": "code", "redirect_uri": redirect, "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
                    "resource": Self.resource, "state": state, "nonce": nonce, "code_challenge_method": "S256",
                    "code_challenge": ChatGPTSecurity.challenge(verifier)]
                if client == nil { query["agent_name_hint"] = "FM26 Manager Room" }
                if let token = selected?.credentials?.idToken { query["id_token_hint"] = token }
                if let email = selected?.email { query["login_hint"] = email }
                if input["consent"] as? Bool == true { query["prompt"] = "consent" }
                var url = URLComponents(string: "https://auth.openai.com/api/accounts/authorize")!
                url.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
                saved.mode = "chatgpt"; saved.changed(); try persist(saved)
                pending = Attempt(state: state, nonce: nonce, verifier: verifier, client: client,
                                  redirect: redirect, expires: clock().addingTimeInterval(600), revision: saved.revision)
                message = "Mac의 브라우저에서 ChatGPT 로그인과 요금제 사용 권한을 승인하세요."
                openBrowser(url.url!)
            case "auth-cancel":
                pending = nil; saved.changed(); try persist(saved); message = "로그인을 취소했습니다."
            case "auth-select":
                guard let client = input["profileId"] as? String, saved.profiles.contains(where: { $0.client == client }) else { throw CoachError.invalid("저장된 ChatGPT 연결을 선택하세요.") }
                pending = nil; saved.active = client; saved.mode = "chatgpt"; saved.changed(); try persist(saved)
                catalogs[client] = nil; message = "계정을 선택했습니다. 모델 목록을 새로고침하세요."
            case "auth-api-key":
                pending = nil; saved.mode = "api-key"; saved.changed(); try persist(saved); message = "Mac에 설정된 API 키 사용을 선택했습니다."
            case "auth-models":
                try loadModels(&saved); message = "사용 가능한 모델을 조회했습니다. 사용할 모델을 선택하세요."
            case "auth-model":
                guard let index = saved.profiles.firstIndex(where: { $0.client == saved.active }),
                      let model = input["model"] as? String, catalogs[saved.active ?? ""]?.contains(where: { $0.slug == model }) == true else { throw CoachError.invalid("현재 계정의 모델 목록에서 선택하세요.") }
                saved.profiles[index].model = model; saved.changed(); try persist(saved); message = "모델을 선택했습니다. 새 전송 미리보기를 확인하세요."
            case "auth-logout":
                pending = nil
                guard let index = saved.profiles.firstIndex(where: { $0.client == saved.active }) else { break }
                let profile = saved.profiles[index]
                var revoked = profile.credentials == nil
                if let refresh = profile.credentials?.refresh {
                    do {
                        let discovery = try object(transport(URLRequest(url: URL(string: "https://auth.openai.com/.well-known/openid-configuration")!)))
                        guard discovery["issuer"] as? String == "https://auth.openai.com", let endpoint = discovery["revocation_endpoint"] as? String,
                              let url = URL(string: endpoint), url.scheme == "https", url.host == "auth.openai.com", url.port == nil, url.user == nil, url.password == nil else { throw CoachError.invalid("폐기 주소 검증 실패.") }
                        revoked = try transport(form(endpoint, ["token": refresh, "token_type_hint": "refresh_token", "client_id": profile.client])).status == 200
                    } catch { revoked = false }
                }
                saved.profiles[index].credentials = nil; saved.profiles[index].model = ""
                catalogs[profile.client] = nil; saved.changed(); try persist(saved)
                message = revoked ? "ChatGPT 연결을 로그아웃했습니다." : "Mac에서 로그아웃했습니다. 서버 세션 폐기는 확인하지 못했습니다. ChatGPT 설정에서 앱 연결을 해제하세요."
            default: throw CoachError.invalid("지원하지 않는 인증 작업입니다.")
            }
            return status(saved)
        }
    }
    /// Never returns tokens, the authorization URL, provider bodies or callback arguments.
    func callback(_ target: String) throws {
        try withSaved { saved in
            guard let attempt = pending, let components = URLComponents(string: "http://127.0.0.1" + target),
                  components.path == "/auth/callback", components.fragment == nil else { throw CoachError.invalid("유효한 로그인 요청이 없습니다.") }
            var values: [String: String] = [:]
            for item in components.queryItems ?? [] {
                guard values[item.name] == nil, let value = item.value else { throw CoachError.invalid("중복되거나 잘못된 로그인 응답입니다.") }
                values[item.name] = value
            }
            guard values["state"] == attempt.state else { throw CoachError.invalid("로그인 state 검증 실패.") }
            pending = nil // Consume matching attempts before any network activity.
            do {
                guard values["error"] == nil else { throw CoachError.invalid("ChatGPT 로그인이 취소되었거나 권한이 거절되었습니다.") }
                let client = values["client_id"] ?? attempt.client ?? ""
                guard !client.isEmpty, client != "dynamic_agent_client", client.utf8.count <= 256,
                      attempt.client == nil || attempt.client == client,
                      let code = values["code"], !code.isEmpty, code.utf8.count <= 8192 else { throw CoachError.invalid("ChatGPT 등록 응답이 올바르지 않습니다.") }
                var index: Int
                if let existing = saved.profiles.firstIndex(where: { $0.client == client }) { index = existing }
                else { saved.profiles.append(Profile(client: client)); index = saved.profiles.count - 1 }
                // Preserve an issued registration even if code redemption expires.
                try persist(saved)
                let result = try object(transport(form(Self.tokenURL, ["grant_type": "authorization_code", "client_id": client,
                    "code": code, "code_verifier": attempt.verifier, "redirect_uri": attempt.redirect, "resource": Self.resource])))
                guard let id = result["id_token"] as? String else { throw CoachError.invalid("ChatGPT ID 토큰이 없습니다.") }
                let jwks = try transport(URLRequest(url: URL(string: "https://auth.openai.com/.well-known/jwks.json")!))
                guard jwks.status == 200 else { throw CoachError.invalid("ChatGPT 서명 키 조회 실패.") }
                let identity = try verify(id, jwks.data, client, attempt.nonce, clock())
                guard let subject = identity["sub"] as? String,
                      saved.profiles[index].subject == nil || saved.profiles[index].subject == subject else { throw CoachError.invalid("선택한 ChatGPT 계정과 로그인 계정이 다릅니다.") }
                saved.profiles[index].subject = subject
                saved.profiles[index].email = (identity["email"] as? String).map { String($0.prefix(256)) }
                saved.profiles[index].credentials = try credentials(result, prior: nil)
                saved.profiles[index].model = ""; catalogs[client] = nil
                saved.active = client; saved.mode = "chatgpt"; saved.changed(); try persist(saved)
                message = "ChatGPT 로그인 완료. 모델 목록을 새로고침하고 모델을 선택하세요."
            } catch {
                saved.changed(); try persist(saved)
                message = (error as? CoachError)?.errorDescription ?? "ChatGPT 로그인 검증 실패. 다시 로그인하세요."
                throw CoachError.invalid(message)
            }
        }
    }
    private func credentials(_ object: [String: Any], prior: Credentials?) throws -> Credentials {
        let scope = object["scope"] as? String
        let scopes = scope.map { $0.split(separator: " ").map(String.init) } ?? prior?.scopes ?? []
        let access = object["access_token"] as? String ?? ""
        let refresh = object["refresh_token"] as? String
        guard let id = object["id_token"] as? String ?? prior?.idToken, id.utf8.count <= 32768,
              !scopes.contains(Self.direct) || (object["token_type"] as? String)?.lowercased() == "bearer",
              !scopes.contains(Self.direct) || (!access.isEmpty && access.utf8.count <= 32768 && !access.contains("\r") && !access.contains("\n")),
              let expires = object["expires_in"] as? Double ?? (scopes.contains(Self.direct) ? nil : 3600), expires > 0, expires <= 86400,
              refresh == nil || (refresh!.utf8.count <= 32768 && !refresh!.isEmpty) else { throw CoachError.invalid("ChatGPT 인증 응답 검증 실패.") }
        return Credentials(access: access, refresh: refresh ?? prior?.refresh, idToken: id, scopes: scopes, expires: clock().addingTimeInterval(expires))
    }
    private func access(_ saved: inout Saved) throws -> String {
        guard pending == nil, saved.mode == "chatgpt", let index = saved.profiles.firstIndex(where: { $0.client == saved.active }),
              var credential = saved.profiles[index].credentials, credential.scopes.contains(Self.direct) else { throw CoachError.invalid("ChatGPT 로그인 후 요금제 사용 권한을 승인하세요.") }
        if credential.expires <= clock().addingTimeInterval(60) {
            guard let refresh = credential.refresh else { throw CoachError.invalid("ChatGPT 세션이 만료되었습니다. 다시 로그인하세요.") }
            let response = try transport(form(Self.tokenURL, ["grant_type": "refresh_token", "client_id": saved.profiles[index].client,
                "refresh_token": refresh, "resource": Self.resource]))
            let result = (try? JSONSerialization.jsonObject(with: response.data)) as? [String: Any] ?? [:]
            let errorCode = (result["error"] as? String) ?? (result["error"] as? [String: Any])?["code"] as? String ?? ""
            if ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].contains(errorCode) {
                saved.profiles[index].credentials = nil; catalogs[saved.profiles[index].client] = nil; saved.changed(); try persist(saved)
                throw CoachError.invalid("ChatGPT 세션이 해제되었거나 만료되었습니다. 저장된 계정으로 다시 로그인하세요.")
            }
            guard response.status == 200 else { throw Self.providerError(response) }
            credential = try credentials(result, prior: credential)
            saved.profiles[index].credentials = credential
            if !credential.scopes.contains(Self.direct) { saved.changed() }
            try persist(saved) // Persist rotating token before any subsequent request.
            guard credential.scopes.contains(Self.direct) else { throw CoachError.invalid("ChatGPT 요금제 사용 권한을 다시 승인하세요.") }
        }
        return credential.access
    }
    private func loadModels(_ saved: inout Saved) throws {
        let token = try access(&saved)
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let result = try object(transport(request))
        guard let rows = result["models"] as? [[String: Any]], rows.count <= 500 else { throw CoachError.invalid("ChatGPT 모델 목록 형식 오류.") }
        let models = rows.filter { $0["visibility"] as? String == "list" }.compactMap { row -> Model? in
            guard let slug = row["slug"] as? String, !slug.isEmpty, slug.utf8.count <= 128,
                  let name = row["display_name"] as? String, name.utf8.count <= 256 else { return nil }
            return Model(slug: slug, name: name)
        }
        catalogs[saved.active ?? ""] = models
        saved.changed(); try persist(saved)
    }
    func send(_ body: Data, revision: String) throws -> String {
        try withSaved { saved in
            let c = config(saved)
            guard c.revision == revision, c.mode == "chatgpt", c.ready,
                  let request = try JSONSerialization.jsonObject(with: body) as? [String: Any], request["model"] as? String == c.model else { throw CoachError.invalid("계정·모델·권한이 변경되었습니다. 새 미리보기를 확인하세요.") }
            let token = try access(&saved)
            return try AICoach.sendChatGPT(body, token: token, transport: transport)
        }
    }
    private func form(_ endpoint: String, _ fields: [String: String]) -> URLRequest {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        let body = fields.sorted { $0.key < $1.key }.map { "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)" }.joined(separator: "&")
        var request = URLRequest(url: URL(string: endpoint)!); request.httpMethod = "POST"; request.httpBody = Data(body.utf8)
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        return request
    }
    private func object(_ response: OpenAIHTTP.Response) throws -> [String: Any] {
        guard response.status == 200, response.data.count <= 1_048_576,
              let object = try JSONSerialization.jsonObject(with: response.data) as? [String: Any] else { throw Self.providerError(response) }
        return object
    }
    static func providerError(_ response: OpenAIHTTP.Response) -> CoachError {
        let root = (try? JSONSerialization.jsonObject(with: response.data)) as? [String: Any] ?? [:]
        let error = (root["error"] as? [String: Any]) ?? (root["response"] as? [String: Any])?["error"] as? [String: Any] ?? [:]
        switch error["code"] as? String {
        case "subscription_sharing_usage_limit_exceeded": return .invalid("ChatGPT 앱 사용 한도에 도달했습니다. ChatGPT 설정 → Usage에서 확인하세요. 자동 재전송하지 않습니다.")
        case "subscription_sharing_user_not_eligible": return .invalid("이 ChatGPT 계정·워크스페이스에서는 요금제 사용을 지원하지 않습니다.")
        case "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable": return .invalid("ChatGPT 사용 가능 여부를 확인하지 못했습니다. 인증은 유지합니다. 나중에 새 미리보기로 시도하세요.")
        default: return .invalid("ChatGPT 요청이 완료되지 않았습니다 (HTTP \(response.status)). 계정 권한·사용 내역을 확인하세요. 자동 재전송하지 않습니다.")
        }
    }
}
