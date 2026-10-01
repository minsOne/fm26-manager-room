import Foundation

enum Command: String {
    case serve
    case probe
    case snapshotPath = "snapshot-path"
}

let args = Array(CommandLine.arguments.dropFirst())
let command = Command(rawValue: args.first ?? "serve") ?? .serve
let store = SnapshotStore.defaultStore()

switch command {
case .probe:
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(FMProcessProbe.probe())
    print(String(decoding: data, as: UTF8.self))

case .snapshotPath:
    print(store.url.path)

case .serve:
    let port = parsePort(args) ?? 8765
    let server = try LocalHTTPServer(port: port, store: store)
    server.start()
    print("FM26 Manager Room companion")
    print("http://127.0.0.1:\(port)")
    print("Snapshot: \(store.url.path)")
    print("Mode: read-only HTTP bridge; FM runtime writes are disabled.")
    RunLoop.main.run()
}

func parsePort(_ args: [String]) -> UInt16? {
    guard let index = args.firstIndex(of: "--port"), args.indices.contains(index + 1) else {
        return nil
    }
    return UInt16(args[index + 1])
}
