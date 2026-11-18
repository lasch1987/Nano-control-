import Foundation
import Network

struct FoundMac: Identifiable, Hashable {
    let id: String
    let name: String
    let host: String // "ip:puerto"
}

/// Busca el puente de Nano Control en la red local (Bonjour: _nanocontrol._tcp).
/// El puente publica su IP y puerto en el registro TXT, así no hace falta resolver nombres .local.
@MainActor
final class MacDiscovery: ObservableObject {
    @Published var macs: [FoundMac] = []
    private var browser: NWBrowser?

    func start() {
        guard browser == nil else { return }
        let params = NWParameters()
        params.includePeerToPeer = true
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: "_nanocontrol._tcp", domain: nil), using: params)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            var list: [FoundMac] = []
            for result in results {
                guard case let .service(name, _, _, _) = result.endpoint else { continue }
                guard case let .bonjour(txt) = result.metadata else { continue }
                let ip = txt["ip"]?.split(separator: ",").first.map(String.init) ?? ""
                let port = txt["port"] ?? "7777"
                if !ip.isEmpty {
                    list.append(FoundMac(id: name, name: name, host: "\(ip):\(port)"))
                }
            }
            list.sort { $0.name < $1.name }
            Task { @MainActor in
                self?.macs = list
            }
        }
        b.stateUpdateHandler = { [weak self] state in
            if case .failed = state {
                Task { @MainActor in
                    self?.browser?.cancel()
                    self?.browser = nil
                }
            }
        }
        b.start(queue: .main)
        browser = b
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }
}
