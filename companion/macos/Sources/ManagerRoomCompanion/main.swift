import Foundation

enum Command: String {
    case serve
    case probe
    case parse
    case snapshotPath = "snapshot-path"
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = Command(rawValue: args.first ?? "serve") else {
    FileHandle.standardError.write(Data("Unknown command. Use serve, parse, probe or snapshot-path.\n".utf8))
    exit(2)
}
let store = SnapshotStore.defaultStore()
let state = CompanionState()

switch command {
case .probe:
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(FMProcessProbe.probe())
    print(String(decoding: data, as: UTF8.self))

case .snapshotPath:
    print(store.url.path)

case .parse:
    guard args.count >= 2 else {
        FileHandle.standardError.write(Data("Usage: manager-room-companion parse /path/to/Career.fm [--parser /path/to/fm26-manager-room-parser]\n".utf8))
        exit(2)
    }
    let saveURL = URL(fileURLWithPath: args[1]).standardizedFileURL
    let parserURL = try NativeParserRunner.resolve(explicit: option("--parser", in: args))
    let runner = NativeParserRunner(parserURL: parserURL, store: store, state: state)
    let duration = try runner.parse(saveURL: saveURL)
    print("Parsed \(saveURL.lastPathComponent) in \(duration) ms")
    print(store.url.path)

case .serve:
    if args.contains("--port") && (parsePort(args) ?? 0) == 0 {
        FileHandle.standardError.write(Data("--port must be an integer from 1 to 65535.\n".utf8))
        exit(2)
    }
    let port = parsePort(args) ?? 8765
    let server = try LocalHTTPServer(port: port, store: store, companionState: state)
    server.start()

    let explicitParser = option("--parser", in: args)
    let explicitSave = option("--save", in: args).map { URL(fileURLWithPath: $0).standardizedFileURL }
    let explicitDirectory = option("--save-dir", in: args).map {
        URL(fileURLWithPath: $0, isDirectory: true).standardizedFileURL
    }
    let noWatch = args.contains("--no-watch")

    var watcher: SaveDirectoryWatcher?
    do {
        let parserURL = try NativeParserRunner.resolve(explicit: explicitParser)
        let runner = NativeParserRunner(parserURL: parserURL, store: store, state: state)
        if let explicitSave { runner.parseAsync(saveURL: explicitSave) }
        if !noWatch {
            let directory = explicitDirectory
                ?? explicitSave?.deletingLastPathComponent()
                ?? SaveDirectoryWatcher.defaultFM26Directory()
            let created = SaveDirectoryWatcher(directoryURL: directory, runner: runner, state: state)
            try created.start(parseInitial: explicitSave == nil)
            watcher = created
        }
    } catch {
        state.parsingFailed(save: explicitSave, error: error)
        FileHandle.standardError.write(Data("Parser/watcher unavailable: \(error.localizedDescription)\n".utf8))
    }

    print("FM26 Manager Room companion")
    print("http://127.0.0.1:\(port)")
    print("Snapshot: \(store.url.path)")
    print("Default saves: \(SaveDirectoryWatcher.defaultFM26Directory().path)")
    print("Mode: native save parser + read-only localhost API; FM runtime writes are disabled.")
    withExtendedLifetime((server, watcher)) {
        RunLoop.main.run()
    }
}

func parsePort(_ args: [String]) -> UInt16? {
    guard let value = option("--port", in: args) else { return nil }
    return UInt16(value)
}

func option(_ name: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: name), args.indices.contains(index + 1) else { return nil }
    return args[index + 1]
}
