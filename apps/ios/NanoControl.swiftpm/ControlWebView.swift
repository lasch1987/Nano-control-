import SwiftUI
import UIKit
import WebKit

/// La superficie de control (servida por el puente del Mac) dentro de un WKWebView sin rebotes ni zoom,
/// con vibración háptica nativa (window.webkit.messageHandlers.haptic).
struct ControlWebView: UIViewRepresentable {
    let url: URL
    var onFail: (String) -> Void
    var onDisconnect: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(context.coordinator, name: "haptic")
        config.userContentController.add(context.coordinator, name: "nano")

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 11 / 255, green: 13 / 255, blue: 16 / 255, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        web.navigationDelegate = context.coordinator
        context.coordinator.load(url, in: web)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.loadedURL != url {
            context.coordinator.load(url, in: web)
        }
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "haptic")
        web.configuration.userContentController.removeScriptMessageHandler(forName: "nano")
        web.stopLoading()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: ControlWebView
        var loadedURL: URL?
        private let haptic = UIImpactFeedbackGenerator(style: .light)

        init(parent: ControlWebView) {
            self.parent = parent
            super.init()
            haptic.prepare()
        }

        func load(_ url: URL, in web: WKWebView) {
            loadedURL = url
            web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 6))
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "haptic":
                haptic.impactOccurred()
                haptic.prepare()
            case "nano":
                if let cmd = message.body as? String, cmd == "disconnect" {
                    parent.onDisconnect()
                }
            default:
                break
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let host = loadedURL?.host ?? ""
            parent.onFail("No se pudo conectar con \(host). ¿Está abierto Nano Control en el Mac y en la misma red? (Ajustes → Nano Control → Red local debe estar activado)")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.onFail("Se perdió la conexión: \(error.localizedDescription)")
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            if let url = loadedURL { load(url, in: webView) } // iOS cerró el proceso web: recargar
        }
    }
}
