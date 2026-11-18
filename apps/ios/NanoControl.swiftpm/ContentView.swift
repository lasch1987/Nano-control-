import SwiftUI

/// Pantalla de conexión (busca el Mac por Bonjour o IP manual) y superficie a pantalla completa.
struct ContentView: View {
    @AppStorage("host") private var savedHost: String = ""
    @StateObject private var discovery = MacDiscovery()
    @State private var hostInput = ""
    @State private var connectedURL: URL?
    @State private var message: String?
    @State private var autoTried = false

    private let bg = Color(red: 11 / 255, green: 13 / 255, blue: 16 / 255)
    private let accent = Color(red: 25 / 255, green: 195 / 255, blue: 1)

    var body: some View {
        ZStack {
            bg.ignoresSafeArea()
            if let url = connectedURL {
                ControlWebView(
                    url: url,
                    onFail: { msg in
                        message = msg
                        connectedURL = nil
                    },
                    onDisconnect: {
                        message = "Desconectado. Elige un Mac o escribe su IP."
                        connectedURL = nil
                    }
                )
                .ignoresSafeArea()
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)
            } else {
                setupView
            }
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true // pantalla siempre encendida
            discovery.start()
            hostInput = savedHost
            if !savedHost.isEmpty && !autoTried {
                autoTried = true
                connect(savedHost)
            }
        }
    }

    private var setupView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("🎛️  Nano Control")
                    .font(.largeTitle.bold())
                Text("Abre «Iniciar Nano Control» en tu Mac. Aparecerá aquí automáticamente si estáis en la misma red Wi‑Fi.")
                    .foregroundStyle(.secondary)

                Text("MACS ENCONTRADOS")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.top, 8)

                if discovery.macs.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Buscando…").foregroundStyle(.secondary)
                    }
                }
                ForEach(discovery.macs) { mac in
                    Button {
                        connect(mac.host)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(mac.name).font(.headline)
                            Text(mac.host).font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
                    }
                    .buttonStyle(.plain)
                }

                Text("O ESCRIBE LA DIRECCIÓN QUE MUESTRA EL MAC")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.top, 8)
                TextField("192.168.1.20:7777", text: $hostInput)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { connect(hostInput) }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))

                Button {
                    connect(hostInput)
                } label: {
                    Text("Conectar").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(accent)
                .foregroundStyle(.black)
                .controlSize(.large)

                if let message {
                    Text(message).foregroundStyle(.yellow)
                }

                Text("Consejo: para la mínima latencia conecta el iPhone/iPad al Mac por cable USB y activa «Compartir Internet» en el Mac, o usa Wi‑Fi de 5 GHz.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(.top, 8)
            }
            .frame(maxWidth: 460)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
    }

    private func connect(_ raw: String) {
        guard let hp = Self.normalize(raw), let url = URL(string: "http://\(hp)/") else {
            message = "Escribe la IP del Mac, por ejemplo 192.168.1.20"
            return
        }
        savedHost = hp
        hostInput = hp
        message = nil
        connectedURL = url
    }

    static func normalize(_ input: String) -> String? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        s = s.replacingOccurrences(of: "http://", with: "").replacingOccurrences(of: "https://", with: "")
        if let slash = s.firstIndex(of: "/") { s = String(s[..<slash]) }
        if s.isEmpty { return nil }
        if !s.contains(":") { s += ":7777" }
        return s
    }
}
