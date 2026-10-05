import UIKit
import UserNotifications
import Security

@MainActor final class NativePush {
    static let shared = NativePush()
    private(set) var token: String?
    private var waiters: [UUID: CheckedContinuation<String, Error>] = [:]
    let installationID: String = {
        if let value = UserDefaults.standard.string(forKey: "installationID") { return value }
        let value = UUID().uuidString; UserDefaults.standard.set(value, forKey: "installationID"); return value
    }()
    var environment: String {
        Bundle.main.object(forInfoDictionaryKey: "APNSEnvironment") as? String ?? "development"
    }
    func status() async -> [String: Any] {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
        var value: [String: Any] = ["installationId": installationID, "environment": environment, "permission": allowed ? "authorized" : settings.authorizationStatus == .denied ? "denied" : "default", "connected": UserDefaults.standard.bool(forKey: "pushConnected")]
        if let token { value["token"] = token }
        return value
    }
    func subscribe() async throws -> [String: Any] {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .denied {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { await UIApplication.shared.open(url) }
            throw NativeError.message("iPhone 설정에서 알림을 허용한 뒤 다시 눌러주세요.")
        }
        let allowed = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard allowed else { throw NativeError.message("알림을 허용해야 받을 수 있어요.") }
        UIApplication.shared.registerForRemoteNotifications()
        if token == nil {
            let id = UUID()
            _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
                waiters[id] = continuation
                Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .seconds(18))
                    self?.waiters.removeValue(forKey: id)?.resume(throwing: NativeError.message("알림 등록이 지연되고 있어요. 잠시 후 다시 눌러주세요."))
                }
            }
        }
        return await status()
    }
    func registered(_ data: Data) {
        let value = data.map { String(format: "%02x", $0) }.joined(); token = value
        let pending = waiters; waiters.removeAll(); pending.values.forEach { $0.resume(returning: value) }
    }
    func failed() {
        let pending = waiters; waiters.removeAll()
        pending.values.forEach { $0.resume(throwing: NativeError.message("Apple 알림 등록을 확인하지 못했어요. 앱 서명과 인터넷 연결을 확인해주세요.")) }
    }
}
enum NativeError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}
