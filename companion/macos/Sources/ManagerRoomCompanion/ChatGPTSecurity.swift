import Foundation
#if canImport(Security)
import Security
import CryptoKit
import Darwin
#endif

/// Credentials never enter the browser, parser environment, diagnostics or repository.
final class ChatGPTVault {
    let read: () throws -> Data?
    let write: (Data) throws -> Void
    private let mutex = NSRecursiveLock()
    private let lockURL: URL?

    init(lockURL: URL? = nil, read: @escaping () throws -> Data?, write: @escaping (Data) throws -> Void) {
        self.lockURL = lockURL; self.read = read; self.write = write
    }
    func transaction<T>(_ body: () throws -> T) throws -> T {
        mutex.lock(); defer { mutex.unlock() }
        #if canImport(Security)
        if let url = lockURL {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            let fd = open(url.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard fd >= 0 else { throw CoachError.invalid("ChatGPT 인증 잠금 파일을 열 수 없습니다.") }
            defer { close(fd) }
            guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { throw CoachError.invalid("다른 Companion이 인증을 처리 중입니다. 잠시 후 다시 시도하세요.") }
            defer { flock(fd, LOCK_UN) }
            return try body()
        }
        #endif
        return try body()
    }
    static func keychain() -> ChatGPTVault {
        #if canImport(Security)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.minsone.fm26-manager-room.chatgpt",
            kSecAttrAccount as String: "profiles-v1", kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
        let lock = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/FM26ManagerRoom/chatgpt.lock")
        return ChatGPTVault(lockURL: lock, read: {
            var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(q as CFDictionary, &result)
            if status == errSecItemNotFound { return nil }
            guard status == errSecSuccess, let data = result as? Data else {
                throw CoachError.invalid("로그인 Keychain 접근 실패. Mac에서 Keychain을 잠금 해제한 뒤 다시 시도하세요.")
            }
            return data
        }, write: { data in
            let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if status == errSecItemNotFound {
                var q = query; q[kSecValueData as String] = data
                q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw CoachError.invalid("ChatGPT 인증을 Keychain에 저장하지 못했습니다.") }
            } else if status != errSecSuccess { throw CoachError.invalid("ChatGPT 인증을 Keychain에 갱신하지 못했습니다.") }
        })
        #else
        return ChatGPTVault(read: { nil }, write: { _ in throw CoachError.invalid("ChatGPT 로그인은 macOS Companion에서 지원합니다.") })
        #endif
    }
}

enum ChatGPTSecurity {
    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func decode(_ value: String) throws -> Data {
        guard !value.isEmpty, value.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }),
              let data = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - value.count % 4) % 4)) else {
            throw CoachError.invalid("ChatGPT 서명 형식이 올바르지 않습니다.")
        }
        return data
    }
    static func random() throws -> String {
        #if canImport(Security)
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw CoachError.invalid("안전한 로그인 난수를 만들지 못했습니다.") }
        return base64URL(Data(bytes))
        #else
        throw CoachError.invalid("macOS 인증이 필요합니다.")
        #endif
    }
    static func challenge(_ verifier: String) -> String {
        #if canImport(CryptoKit)
        return base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        #else
        return ""
        #endif
    }
    /// Accept only the pinned issuer, expected client, nonce and an RSA SHA-256 signature.
    static func identity(_ token: String, jwks: Data, client: String, nonce: String?, now: Date) throws -> [String: Any] {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard token.utf8.count <= 32768, parts.count == 3,
              let header = try JSONSerialization.jsonObject(with: decode(parts[0])) as? [String: Any],
              header["alg"] as? String == "RS256", header["crit"] == nil,
              let kid = header["kid"] as? String,
              let keys = (try JSONSerialization.jsonObject(with: jwks) as? [String: Any])?["keys"] as? [[String: Any]] else {
            throw CoachError.invalid("ChatGPT ID 토큰 형식 또는 서명 알고리즘을 확인할 수 없습니다.")
        }
        let matches = keys.filter { $0["kid"] as? String == kid && $0["kty"] as? String == "RSA" && ($0["use"] == nil || $0["use"] as? String == "sig") && ($0["alg"] == nil || $0["alg"] as? String == "RS256") }
        guard matches.count == 1, let n = matches[0]["n"] as? String, let e = matches[0]["e"] as? String else { throw CoachError.invalid("ChatGPT 서명 키가 일치하지 않습니다.") }
        #if canImport(Security)
        func tlv(_ tag: UInt8, _ value: Data) -> Data {
            let length = value.count
            let prefix: [UInt8] = length < 128 ? [UInt8(length)] : length < 256 ? [0x81, UInt8(length)] : [0x82, UInt8(length >> 8), UInt8(length & 255)]
            return Data([tag] + prefix) + value
        }
        func integer(_ value: Data) -> Data {
            var bytes = Data(value.drop(while: { $0 == 0 }))
            if bytes.first.map({ $0 & 0x80 != 0 }) ?? true { bytes.insert(0, at: 0) }
            return tlv(0x02, bytes)
        }
        let modulus = try decode(n), exponent = try decode(e)
        guard (256...1024).contains(modulus.count), (1...8).contains(exponent.count) else { throw CoachError.invalid("ChatGPT RSA 키 길이가 올바르지 않습니다.") }
        let der = tlv(0x30, integer(modulus) + integer(exponent))
        guard let key = SecKeyCreateWithData(der as CFData, [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic] as CFDictionary, nil),
              SecKeyVerifySignature(key, .rsaSignatureMessagePKCS1v15SHA256, Data("\(parts[0]).\(parts[1])".utf8) as CFData, try decode(parts[2]) as CFData, nil) else {
            throw CoachError.invalid("ChatGPT ID 토큰 서명 검증 실패.")
        }
        #else
        throw CoachError.invalid("macOS 서명 검증이 필요합니다.")
        #endif
        guard let claims = try JSONSerialization.jsonObject(with: decode(parts[1])) as? [String: Any],
              claims["iss"] as? String == "https://auth.openai.com",
              let sub = claims["sub"] as? String, !sub.isEmpty, sub.utf8.count <= 512,
              let exp = claims["exp"] as? Double, exp > now.timeIntervalSince1970,
              (claims["nbf"] as? Double ?? 0) <= now.timeIntervalSince1970 + 30 else { throw CoachError.invalid("ChatGPT ID 토큰의 발급자·계정·유효기간 검증 실패.") }
        let audience = (claims["aud"] as? [String]) ?? (claims["aud"] as? String).map { [$0] } ?? []
        guard audience.contains(client), (audience.count == 1 || claims["azp"] as? String == client),
              claims["azp"] == nil || claims["azp"] as? String == client,
              nonce == nil || claims["nonce"] as? String == nonce else { throw CoachError.invalid("ChatGPT ID 토큰의 대상·nonce 검증 실패.") }
        return claims
    }
}
