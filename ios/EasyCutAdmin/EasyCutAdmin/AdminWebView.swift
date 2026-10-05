import SwiftUI
import WebKit
import AuthenticationServices
import CryptoKit

struct AdminWebView: UIViewRepresentable {
    @ObservedObject var model: AdminWebModel
    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

@MainActor final class AdminWebModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, ASWebAuthenticationPresentationContextProviding {
    static let origin = "https://www.easycut.co.kr"
    @Published var loading = true
    @Published var error: String?
    private var authSession: ASWebAuthenticationSession?
    private var pendingInbox = false
    lazy var webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "easycutNative")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self; view.uiDelegate = self
        view.isOpaque = false; view.backgroundColor = .systemBackground
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsBackForwardNavigationGestures = false
        return view
    }()
    override init() { super.init(); load() }
    private func trusted(_ url: URL?) -> Bool {
        url?.scheme == "https" && url?.host == "www.easycut.co.kr" && (url?.port == nil || url?.port == 443) && url?.user == nil && url?.password == nil
    }
    func load() {
        error = nil; loading = true
        var url = URL(string: Self.origin + "/admin-app/index.html")!
        if pendingInbox { url = URL(string: url.absoluteString + "#inbox")!; pendingInbox = false }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25))
    }
    func foreground() {
        if UserDefaults.standard.bool(forKey: "pushConnected") { UIApplication.shared.registerForRemoteNotifications() }
        notify("easycut-native-foreground")
    }
    func notify(_ name: String) {
        guard trusted(webView.url), webView.url?.path.hasPrefix("/admin-app/") == true else { return }
        Task { try? await webView.callAsyncJavaScript("window.dispatchEvent(new Event(name))", arguments: ["name": name], in: nil, contentWorld: .page) }
    }
    func openInbox() {
        if trusted(webView.url), webView.url?.path.hasPrefix("/admin-app/") == true {
            webView.evaluateJavaScript("location.hash='inbox'") { _, _ in }
        } else { pendingInbox = true; load() }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false; notify("easycut-native-ready") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError issue: Error) { if (issue as NSError).code != NSURLErrorCancelled { loading = false; error = "인터넷 연결을 확인한 뒤 다시 열어주세요." } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError issue: Error) { loading = false; error = "화면을 불러오지 못했어요. 다시 시도해주세요." }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { load() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if trusted(url), url.path == "/auth/sign-in" {
            decisionHandler(.cancel); login(); return
        }
        if trusted(url), url.path.hasPrefix("/admin-app/") { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" { UIApplication.shared.open(url) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { UIApplication.shared.open(url) }
        return nil
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), message.frameInfo.request.url?.path.hasPrefix("/admin-app/") == true,
              trusted(webView.url), let body = message.body as? [String: Any], let action = body["action"] as? String else { replyHandler(nil, "허용되지 않은 요청입니다."); return }
        Task { @MainActor in
            do {
                switch action {
                case "status": replyHandler(await NativePush.shared.status(), nil)
                case "subscribe": replyHandler(try await NativePush.shared.subscribe(), nil)
                case "connected": UserDefaults.standard.set(true, forKey: "pushConnected"); replyHandler(["ok": true], nil)
                case "disconnect": UserDefaults.standard.set(false, forKey: "pushConnected"); replyHandler(["ok": true], nil)
                default: replyHandler(nil, "지원하지 않는 요청입니다.")
                }
            } catch { replyHandler(["error": error.localizedDescription], nil) }
        }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { webView.window ?? ASPresentationAnchor() }
    private func randomString() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess)
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    private func login() {
        guard authSession == nil else { return }
        let verifier = randomString(), state = randomString()
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        var components = URLComponents(string: Self.origin + "/api/admin/mobile/native/auth")!
        components.queryItems = [URLQueryItem(name: "challenge", value: challenge), URLQueryItem(name: "state", value: state)]
        let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: "easycut-admin") { [weak self] url, issue in
            Task { @MainActor in
                guard let self else { return }; self.authSession = nil
                if let issue = issue as? ASWebAuthenticationSessionError, issue.code == .canceledLogin { return }
                guard let url, url.scheme == "easycut-admin", url.host == "auth", let params = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                      params.first(where: { $0.name == "state" })?.value == state, let code = params.first(where: { $0.name == "code" })?.value else { self.error = "로그인을 완료하지 못했어요. 다시 시도해주세요."; return }
                do { try await self.exchange(code: code, verifier: verifier); self.load() }
                catch { self.error = "로그인 연결이 만료됐어요. 다시 로그인해주세요."; self.loading = false }
            }
        }
        session.presentationContextProvider = self; session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() { authSession = nil; error = "로그인 창을 열지 못했어요. 다시 시도해주세요." }
    }
    private func exchange(code: String, verifier: String) async throws {
        let url = URL(string: Self.origin + "/api/admin/mobile/native/exchange")!
        var request = URLRequest(url: url); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code, "verifier": verifier])
        request.timeoutInterval = 20
        let session = URLSession(configuration: .ephemeral); defer { session.invalidateAndCancel() }
        let (_, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, response.url == url,
              let headers = response.allHeaderFields as? [String: String] else { throw NativeError.message("로그인 실패") }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url).filter { $0.name == "__Secure-easycut-admin-native" && $0.isSecure && $0.domain == "www.easycut.co.kr" }
        guard !cookies.isEmpty else { throw NativeError.message("로그인 실패") }
        for cookie in cookies { await webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }
    }
}
