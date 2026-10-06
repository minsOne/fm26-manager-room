import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Security)
import Security
#endif

enum ChatGPTAuthTests {
    static func validate(_ value: Bool) throws { try check(value, "ChatGPT assertion failed") }
    static func stream(_ value: String = "관측 해석") throws -> Data {
        let event: [String: Any] = ["type": "response.completed", "response": ["status": "completed", "output": [
            ["type": "message", "role": "assistant", "content": [["type": "output_text", "text": value]]]]]]
        return Data("event: response.completed\r\ndata: \(String(decoding: try JSONSerialization.data(withJSONObject: event), as: UTF8.self))\r\n\r\ndata: [DONE]\r\n\r\n".utf8)
    }
    static func run() throws {
        let complete = try stream()
        try validate(try AICoach.streamAnswer(complete) == "관측 해석")
        try rejects { _ = try AICoach.streamAnswer(Data("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n".utf8)) }
        try rejects { _ = try AICoach.streamAnswer(complete.dropLast(4)) }
        try rejects { _ = try AICoach.streamAnswer(complete + Data("data: {\"type\":\"response.failed\"}\n\n".utf8)) }
        try rejects { _ = try AICoach.streamAnswer(complete + complete) }
        try rejects { _ = try AICoach.streamAnswer(Data(repeating: 65, count: 1_048_577)) }
        let limited = Data("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"message\":\"secret\"}}}\n\n".utf8)
        do { _ = try AICoach.streamAnswer(limited); throw TestFailure(message: "expected limit") }
        catch let error as CoachError { try validate(error.localizedDescription.contains("사용 한도") && !error.localizedDescription.contains("secret")) }

        let policy = LocalRequestPolicy(port: 8765)
        let callbackRequest = "GET /auth/callback?state=test&code=secret HTTP/1.1\r\nHost: 127.0.0.1:8765\r\n\r\n"
        let parsed = try policy.parse(callbackRequest)
        try validate(parsed.path == "/auth/callback" && parsed.target.contains("state=test"))
        try rejects { _ = try policy.parse(callbackRequest.replacingOccurrences(of: "127.0.0.1", with: "localhost")) }
        try rejects { _ = try policy.parse(callbackRequest.replacingOccurrences(of: "\r\n\r\n", with: "\r\nOrigin: https://minsone.github.io\r\n\r\n")) }
        try rejects { _ = try policy.parse(callbackRequest.replacingOccurrences(of: "GET ", with: "POST ")) }
        #if canImport(Security)
        try signedIdentity()
        try lifecycle()
        #endif
    }
    #if canImport(Security)
    static func signedIdentity() throws {
        let key = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048] as CFDictionary, nil)!
        let publicBytes = SecKeyCopyExternalRepresentation(SecKeyCopyPublicKey(key)!, nil)! as Data
        var offset = 0
        func value(_ tag: UInt8) throws -> Data {
            guard publicBytes[offset] == tag else { throw TestFailure(message: "DER tag") }; offset += 1
            var length = Int(publicBytes[offset]); offset += 1
            if length >= 128 { let count = length & 127; length = 0; for _ in 0..<count { length = length * 256 + Int(publicBytes[offset]); offset += 1 } }
            let result = publicBytes.subdata(in: offset..<offset + length)
            if tag != 0x30 { offset += length }
            return result
        }
        _ = try value(0x30)
        let n = try value(0x02), e = try value(0x02)
        let jwks = try JSONSerialization.data(withJSONObject: ["keys": [["kty": "RSA", "kid": "test", "alg": "RS256", "use": "sig",
            "n": ChatGPTSecurity.base64URL(Data(n.drop(while: { $0 == 0 }))), "e": ChatGPTSecurity.base64URL(e)]]])
        let now = Date()
        let base: [String: Any] = ["iss": "https://auth.openai.com", "sub": "subject", "aud": "oaiapp_test", "nonce": "expected", "exp": now.timeIntervalSince1970 + 60]
        func jwt(_ claims: [String: Any], alg: String = "RS256") throws -> String {
            let header = ChatGPTSecurity.base64URL(try JSONSerialization.data(withJSONObject: ["alg": alg, "kid": "test"]))
            let payload = ChatGPTSecurity.base64URL(try JSONSerialization.data(withJSONObject: claims))
            let body = "\(header).\(payload)"
            let signature = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, Data(body.utf8) as CFData, nil)! as Data
            return "\(body).\(ChatGPTSecurity.base64URL(signature))"
        }
        let valid = try jwt(base)
        let identity = try ChatGPTSecurity.identity(valid, jwks: jwks, client: "oaiapp_test", nonce: "expected", now: now)
        try validate(identity["sub"] as? String == "subject")
        for (field, invalid) in [("iss", "https://evil.example" as Any), ("aud", "other" as Any), ("nonce", "other" as Any), ("exp", now.timeIntervalSince1970 - 1 as Any), ("nbf", now.timeIntervalSince1970 + 1000 as Any), ("azp", "other" as Any)] {
            var claims = base; claims[field] = invalid
            try rejects { _ = try ChatGPTSecurity.identity(jwt(claims), jwks: jwks, client: "oaiapp_test", nonce: "expected", now: now) }
        }
        try rejects { _ = try ChatGPTSecurity.identity(jwt(base, alg: "none"), jwks: jwks, client: "oaiapp_test", nonce: "expected", now: now) }
        let pieces = valid.split(separator: ".").map(String.init)
        let forged = "\(pieces[0]).\(ChatGPTSecurity.base64URL(Data("{}".utf8))).\(pieces[2])"
        try rejects { _ = try ChatGPTSecurity.identity(forged, jwks: jwks, client: "oaiapp_test", nonce: "expected", now: now) }
        try validate(ChatGPTSecurity.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
    static func lifecycle() throws {
        var stored: Data?, opened: URL?, time = Date(), requests: [URLRequest] = []
        var direct = true, tokenFailure = false, revokeFailure = false, subject = "verified-subject", nonceExpected = ""
        var refreshes = 0, sends = 0
        let vault = ChatGPTVault(read: { stored }, write: { stored = $0 })
        let transport: OpenAIHTTP.Transport = { request in
            requests.append(request)
            let url = request.url!.absoluteString
            if url.hasSuffix("/responses") { sends += 1; return .init(status: 200, data: try stream()) }
            if url.hasSuffix("/revoke") {
                if revokeFailure { throw CoachError.invalid("network failure") }
                return .init(status: 200, data: Data())
            }
            var object: [String: Any] = [:]
            if url.hasSuffix("/token") {
                let form = String(decoding: request.httpBody!, as: UTF8.self)
                try validate(!form.contains("client_id=dynamic_agent_client") && !form.contains("client_secret"))
                if form.contains("grant_type=refresh_token") {
                    refreshes += 1
                    try validate(!form.contains("scope="))
                    if tokenFailure { return .init(status: 400, data: Data("{\"error\":\"invalid_grant\"}".utf8)) }
                }
                object = ["id_token": "private-id", "access_token": "private-access-\(refreshes)", "refresh_token": "private-refresh-\(refreshes)",
                          "token_type": "Bearer", "expires_in": 3600, "scope": direct ? "openid email offline_access resource.invoke chatgpt.tokens.use.direct" : "openid email"]
            } else if url.hasSuffix("/models") {
                object = ["models": [["slug": "visible", "display_name": "Visible", "visibility": "list"],
                    ["slug": "second", "display_name": "Second", "visibility": "list"], ["slug": "hidden", "display_name": "Hidden", "visibility": "hidden"]]]
            } else if url.hasSuffix("openid-configuration") {
                object = ["issuer": "https://auth.openai.com", "revocation_endpoint": "https://auth.openai.com/api/accounts/oauth/revoke"]
            }
            return .init(status: 200, data: try JSONSerialization.data(withJSONObject: object))
        }
        let auth = ChatGPTAuth(port: 8765, vault: vault, transport: transport, clock: { time },
            verify: { _, _, client, nonce, _ in
                try validate(client == "oaiapp_one" || client == "oaiapp_two")
                if let nonce { try validate(nonce == nonceExpected) }
                return ["sub": subject, "email": "same@example.test"]
            }, openBrowser: { opened = $0 })
        func login(_ profile: String? = nil, client: String = "oaiapp_one") throws -> String {
            _ = try auth.action("auth-login", input: profile.map { ["profileId": $0] } ?? [:])
            let query = Dictionary(uniqueKeysWithValues: URLComponents(url: opened!, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
            nonceExpected = query["nonce"]!
            try validate(query["client_id"] == (profile ?? "dynamic_agent_client"))
            try validate(query["redirect_uri"] == "http://127.0.0.1:8765/auth/callback" && query["code_challenge_method"] == "S256")
            try validate(query["scope"]!.contains("chatgpt.tokens.use.direct"))
            if profile != nil { try validate(query["agent_name_hint"] == nil) }
            return "/auth/callback?state=\(query["state"]!)&code=private-code&client_id=\(client)"
        }
        var callback = try login()
        let host = try JSONDecoder().decode(ChatGPTAuth.Saved.self, from: stored!).host
        try rejects { try auth.callback(callback.replacingOccurrences(of: "state=", with: "state=wrong")) }
        try validate(requests.isEmpty)
        try rejects { try auth.callback(callback + "&state=duplicate") }
        try auth.callback(callback)
        try validate(sends == 0 && (try auth.status())["connected"] as? Bool == true)
        try rejects { try auth.callback(callback) }
        _ = try auth.action("auth-models", input: [:])
        try rejects { _ = try auth.action("auth-model", input: ["model": "hidden"]) }
        _ = try auth.action("auth-model", input: ["model": "visible"])
        let status = String(decoding: try JSONSerialization.data(withJSONObject: auth.status()), as: UTF8.self)
        try validate(!status.contains("private-") && !status.contains("access_token"))
        try withDirectory { dir in
            let (store, state, _) = try webContext(dir)
            let web = WebActions(store: store, state: state, chatGPT: auth)
            func preview() throws -> [String: Any] {
                try JSONSerialization.jsonObject(with: web.perform(webInput("coach-preview", ["playerId": "1", "question": "설명"]))) as! [String: Any]
            }
            var ticket = try preview()
            let request = ticket["request"] as! [String: Any]
            try validate(request["stream"] as? Bool == true && request["max_output_tokens"] == nil && ticket["sendEnabled"] as? Bool == true)
            _ = try auth.action("auth-model", input: ["model": "second"])
            try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket["previewId"]!])) }
            try validate(sends == 0)
            time = time.addingTimeInterval(3550); ticket = try preview()
            _ = try web.perform(webInput("coach-send", ["previewId": ticket["previewId"]!]))
            try validate(sends == 1 && refreshes == 1)
            let saved = try JSONDecoder().decode(ChatGPTAuth.Saved.self, from: stored!)
            try validate(saved.profiles[0].credentials?.refresh == "private-refresh-1")
            try rejects { _ = try web.perform(webInput("coach-send", ["previewId": ticket["previewId"]!])) }
            try validate(sends == 1)
        }
        // Same email, different registrations remain distinct. Returning identity cannot overwrite another account.
        callback = try login("oaiapp_one")
        subject = "unexpected"
        try rejects { try auth.callback(callback) }
        subject = "verified-subject"
        callback = try login(client: "oaiapp_two"); try auth.callback(callback)
        let saved = try JSONDecoder().decode(ChatGPTAuth.Saved.self, from: stored!)
        try validate(saved.profiles.count == 2 && saved.host == host)
        _ = try auth.action("auth-select", input: ["profileId": "oaiapp_one"])
        time = time.addingTimeInterval(3600); tokenFailure = true
        try rejects { _ = try auth.action("auth-models", input: [:]) }
        try validate((try auth.status())["connected"] as? Bool == false)
        tokenFailure = false; direct = false
        callback = try login("oaiapp_one"); try auth.callback(callback)
        try validate((try auth.status())["connected"] as? Bool == true && (try auth.status())["planEnabled"] as? Bool == false)
        try rejects { _ = try auth.action("auth-models", input: [:]) }
        direct = true; callback = try login("oaiapp_one"); try auth.callback(callback)
        revokeFailure = true
        let loggedOut = try auth.action("auth-logout", input: [:])
        try validate(loggedOut["connected"] as? Bool == false && (loggedOut["message"] as? String)?.contains("서버 세션 폐기") == true)
        try validate(try JSONDecoder().decode(ChatGPTAuth.Saved.self, from: stored!).profiles[0].credentials == nil)
        callback = try login("oaiapp_one"); time = time.addingTimeInterval(601)
        try rejects { try auth.callback(callback) }
        callback = try login("oaiapp_one"); _ = try auth.action("auth-cancel", input: [:])
        try rejects { try auth.callback(callback) }
        _ = try auth.action("auth-api-key", input: [:])
        try validate((try auth.configuration()).mode == "api-key")
    }
    #endif
}
