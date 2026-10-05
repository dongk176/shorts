import SwiftUI
import UserNotifications

@main
struct EasyCutAdminApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AdminWebModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 0.97, green: 0.97, blue: 0.99).ignoresSafeArea()
                AdminWebView(model: model).ignoresSafeArea()
                if let error = model.error {
                    VStack(spacing: 18) {
                        Image(systemName: "wifi.exclamationmark").font(.system(size: 36)).foregroundStyle(.secondary)
                        Text("연결을 확인해주세요").font(.title2.bold())
                        Text(error).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("다시 시도") { model.load() }.buttonStyle(.borderedProminent).tint(.purple)
                    }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
                } else if model.loading {
                    ProgressView().tint(.purple).padding(22).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
                }
                if phase != .active {
                    VStack(spacing: 14) { Text("e.").font(.system(size: 52, weight: .bold)).foregroundStyle(.purple); Text("EasyCut Admin").foregroundStyle(.secondary) }
                        .frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
                }
            }
            .onAppear { delegate.model = model }
            .onChange(of: phase) { _, value in if value == .active { model.foreground() } }
        }
    }
}

@MainActor final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private var pendingInbox = false
    weak var model: AdminWebModel? {
        didSet { if pendingInbox { model?.openInbox(); pendingInbox = false } }
    }
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        if UserDefaults.standard.bool(forKey: "pushConnected") { application.registerForRemoteNotifications() }
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NativePush.shared.registered(deviceToken)
        model?.notify("easycut-native-ready")
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NativePush.shared.failed()
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound, .list] }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await MainActor.run {
            if let model = self.model { model.openInbox() } else { self.pendingInbox = true }
        }
    }
}
