import Foundation

enum Command: String {
    case serve, probe, parse
    case snapshotPath = "snapshot-path"
    case pinSave = "pin-save"
    case unpinSave = "unpin-save"
    case selection
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = Command(rawValue: args.first ?? "serve") else {
    FileHandle.standardError.write(Data(
        "Unknown command. Use serve, parse, probe, snapshot-path, pin-save, unpin-save or selection.\n".utf8
    ))
    exit(2)
}

let store = try selectedStore(args)
let selectionStore = SaveSelectionStore.defaultStore()
let state = CompanionState()

switch command {
case .probe:
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(FMProcessProbe.probe())
    print(String(decoding: data, as: UTF8.self))

case .snapshotPath:
    print(store.url.path)

case .pinSave:
    guard args.count >= 2, !args[1].hasPrefix("--") else {
        FileHandle.standardError.write(Data(
            "Usage: manager-room-companion pin-save /path/to/Career.fm\n".utf8
        ))
        exit(2)
    }
    let selected = try selectionStore.pin(URL(fileURLWithPath: args[1]))
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    print(String(decoding: try encoder.encode(selected), as: UTF8.self))

case .unpinSave:
    try selectionStore.clear()
    print("Pinned save cleared.")

case .selection:
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let selected = selectionStore.load() {
        print(String(decoding: try encoder.encode(selected), as: UTF8.self))
    } else {
        print("{}")
    }

case .parse:
    guard args.count >= 2, !args[1].hasPrefix("--") else {
        FileHandle.standardError.write(Data(
            "Usage: manager-room-companion parse /path/to/Career.fm [--parser /path/to/parser] [--snapshot-file /path/to/snapshot.json]\n".utf8
        ))
        exit(2)
    }
    let saveURL = URL(fileURLWithPath: args[1]).resolvingSymlinksInPath().standardizedFileURL
    state.setSelection(id: nil, path: saveURL.path, mode: "explicit")
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
    let explicitSave = option("--save", in: args).map {
        URL(fileURLWithPath: $0).resolvingSymlinksInPath().standardizedFileURL
    }
    let explicitDirectory = option("--save-dir", in: args).map {
        URL(fileURLWithPath: $0, isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
    }
    let persisted = selectionStore.load()
    let noWatch = args.contains("--no-watch")

    let selectedSave: URL?
    let selectedId: String?
    let selectionMode: String
    let directory: URL

    if let explicitSave {
        selectedSave = explicitSave
        selectedId = persisted?.path == explicitSave.path ? persisted?.id : nil
        selectionMode = "explicit"
        directory = explicitSave.deletingLastPathComponent()
    } else if let explicitDirectory {
        selectedSave = nil
        selectedId = nil
        selectionMode = "latest-directory"
        directory = explicitDirectory
    } else if let persisted {
        let pinned = URL(fileURLWithPath: persisted.path).resolvingSymlinksInPath().standardizedFileURL
        selectedSave = pinned
        selectedId = persisted.id
        selectionMode = "pinned"
        directory = pinned.deletingLastPathComponent()
    } else {
        selectedSave = nil
        selectedId = nil
        selectionMode = "latest-directory"
        directory = SaveDirectoryWatcher.defaultFM26Directory()
    }

    state.setSelection(id: selectedId, path: selectedSave?.path, mode: selectionMode)

    var watcher: SaveDirectoryWatcher?
    do {
        let parserURL = try NativeParserRunner.resolve(explicit: explicitParser)
        let runner = NativeParserRunner(parserURL: parserURL, store: store, state: state)

        if let explicitSave {
            runner.parseAsync(saveURL: explicitSave)
        } else if noWatch, let selectedSave {
            runner.parseAsync(saveURL: selectedSave)
        }

        if !noWatch {
            let created = SaveDirectoryWatcher(
                directoryURL: directory,
                runner: runner,
                state: state,
                pinnedSaveURL: selectedSave
            )
            try created.start(parseInitial: explicitSave == nil)
            watcher = created
        }
    } catch {
        state.parsingFailed(save: selectedSave, error: error)
        FileHandle.standardError.write(Data(
            "Parser/watcher unavailable: \(error.localizedDescription)\n".utf8
        ))
    }

    print("FM26 Manager Room companion")
    print("http://127.0.0.1:\(port)")
    print("Snapshot: \(store.url.path)")
    print("Selection mode: \(selectionMode)")
    if let selectedSave { print("Selected save: \(selectedSave.path)") }
    else { print("Watched directory: \(directory.path)") }
    print("Mode: native save parser + read-only localhost API; FM runtime writes are disabled.")

    withExtendedLifetime((server, watcher)) {
        RunLoop.main.run()
    }
}

func selectedStore(_ args: [String]) throws -> SnapshotStore {
    guard args.contains("--snapshot-file") else { return SnapshotStore.defaultStore() }
    guard args.filter({ $0 == "--snapshot-file" }).count == 1,
          let path = option("--snapshot-file", in: args), !path.isEmpty, !path.hasPrefix("--") else {
        throw NSError(domain: "ManagerRoomCLI", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "--snapshot-file requires one JSON file path."
        ])
    }
    let url = URL(fileURLWithPath: path).standardizedFileURL
    guard url.pathExtension.lowercased() == "json" else {
        throw NSError(domain: "ManagerRoomCLI", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "Snapshot output must be a .json file, never a .fm save."
        ])
    }
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    return SnapshotStore(url: url)
}

func parsePort(_ args: [String]) -> UInt16? {
    guard let value = option("--port", in: args) else { return nil }
    return UInt16(value)
}

func option(_ name: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: name), args.indices.contains(index + 1) else { return nil }
    return args[index + 1]
}
