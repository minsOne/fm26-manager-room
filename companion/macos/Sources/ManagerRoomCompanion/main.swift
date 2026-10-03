import Foundation

enum Command: String {
    case serve, probe, parse
    case snapshotPath = "snapshot-path"
    case pinSave = "pin-save"
    case unpinSave = "unpin-save"
    case selection, doctor
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = Command(rawValue: args.first ?? "serve") else {
    FileHandle.standardError.write(Data(
        "Unknown command. Use serve, parse, probe, snapshot-path, pin-save, unpin-save, selection or doctor.\n".utf8
    ))
    exit(2)
}

let store = try selectedStore(args)
let selectionStore = SaveSelectionStore.defaultStore()
let historyStore = DevelopmentHistoryStore.defaultStore()
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

case .doctor:
    let explicitParser = option("--parser", in: args)
    let parserURL = try? NativeParserRunner.resolve(explicit: explicitParser)
    let selected = selectionStore.load()
    let defaultDirectory = SaveDirectoryWatcher.defaultFM26Directory()
    let deep = args.contains("--deep")
    var notes: [String] = []

    if parserURL == nil {
        notes.append("Native parser is unavailable. Install both binaries in the same directory or pass --parser.")
    }
    if let selected {
        if !FileManager.default.fileExists(atPath: selected.path) {
            notes.append("The pinned save no longer exists at its recorded path.")
        }
    } else {
        notes.append("No save is pinned. Run pin-save /path/to/Career.fm for deterministic watching.")
    }
    if selected == nil && !FileManager.default.fileExists(atPath: defaultDirectory.path) {
        notes.append("The default FM26 games directory was not found.")
    }

    var deepResult = DoctorDeepResult.notRequested
    if deep {
        if let parserURL, let selected {
            let selectedURL = URL(fileURLWithPath: selected.path)
            if FileManager.default.fileExists(atPath: selectedURL.path) {
                let root = FileManager.default.temporaryDirectory
                    .appendingPathComponent("manager-room-doctor-\(UUID().uuidString)", isDirectory: true)
                do {
                    try FileManager.default.createDirectory(
                        at: root,
                        withIntermediateDirectories: false,
                        attributes: [.posixPermissions: 0o700]
                    )
                    defer { try? FileManager.default.removeItem(at: root) }

                    let temporaryStore = SnapshotStore(url: root.appendingPathComponent("snapshot.json"))
                    let temporaryState = CompanionState()
                    let runner = NativeParserRunner(
                        parserURL: parserURL,
                        store: temporaryStore,
                        state: temporaryState,
                        timeoutSeconds: 120
                    )
                    let duration = try runner.parse(saveURL: selectedURL)
                    let data = try temporaryStore.read()
                    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    let players = (object?["players"] as? [[String: Any]])?.count ?? 0
                    let fixtures = (object?["fixtures"] as? [[String: Any]])?.count ?? 0
                    deepResult = .passed(
                        durationMilliseconds: duration,
                        players: players,
                        fixtures: fixtures
                    )
                } catch {
                    deepResult = .failed(error.localizedDescription)
                }
            } else {
                deepResult = .failed("Pinned save does not exist.")
            }
        } else if parserURL == nil {
            deepResult = .failed("Native parser is unavailable.")
        } else {
            deepResult = .failed("No pinned save is available for deep validation.")
        }
    }

    let selectedExists = selected.map { FileManager.default.fileExists(atPath: $0.path) }
    let healthy = parserURL != nil
        && selectedExists != false
        && (!deep || deepResult.passed)

    let report = DoctorReport(
        platform: "macOS",
        healthy: healthy,
        parserAvailable: parserURL != nil,
        parserPath: parserURL?.path,
        snapshotPath: store.url.path,
        snapshotExists: store.exists,
        selectionId: selected?.id,
        selectedSavePath: selected?.path,
        selectedSaveExists: selectedExists,
        defaultSaveDirectory: defaultDirectory.path,
        defaultSaveDirectoryExists: FileManager.default.fileExists(atPath: defaultDirectory.path),
        webURL: "https://minsone.github.io/fm26-manager-room/",
        deep: deepResult,
        notes: notes
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    print(String(decoding: try encoder.encode(report), as: UTF8.self))
    if !healthy { exit(4) }

case .parse:
    guard args.count >= 2, !args[1].hasPrefix("--") else {
        FileHandle.standardError.write(Data(
            "Usage: manager-room-companion parse /path/to/Career.fm [--parser /path/to/parser] [--snapshot-file /path/to/snapshot.json]\n".utf8
        ))
        exit(2)
    }
    let saveURL = URL(fileURLWithPath: args[1]).resolvingSymlinksInPath().standardizedFileURL
    let persisted = selectionStore.load()
    let selectionId = persisted?.path == saveURL.path ? persisted?.id : nil
    state.setSelection(id: selectionId, path: saveURL.path, mode: "explicit")
    let parserURL = try NativeParserRunner.resolve(explicit: option("--parser", in: args))
    let runner = NativeParserRunner(
        parserURL: parserURL,
        store: store,
        state: state,
        historyStore: historyStore
    )
    let duration = try runner.parse(saveURL: saveURL)
    print("Parsed \(saveURL.lastPathComponent) in \(duration) ms")
    print(store.url.path)

case .serve:
    if args.contains("--port") && (parsePort(args) ?? 0) == 0 {
        FileHandle.standardError.write(Data("--port must be an integer from 1 to 65535.\n".utf8))
        exit(2)
    }

    let port = parsePort(args) ?? 8765
    let server = try LocalHTTPServer(
        port: port,
        store: store,
        companionState: state,
        historyStore: historyStore
    )
    server.start()

    if args.contains("--open-web") {
        openManagerRoomWeb()
    }

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
        let runner = NativeParserRunner(
            parserURL: parserURL,
            store: store,
            state: state,
            historyStore: historyStore
        )

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
    if args.contains("--open-web") {
        print("Opening Manager Room in the default browser.")
    }

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


struct DoctorReport: Codable {
    let platform: String
    let healthy: Bool
    let parserAvailable: Bool
    let parserPath: String?
    let snapshotPath: String
    let snapshotExists: Bool
    let selectionId: String?
    let selectedSavePath: String?
    let selectedSaveExists: Bool?
    let defaultSaveDirectory: String
    let defaultSaveDirectoryExists: Bool
    let webURL: String
    let deep: DoctorDeepResult
    let notes: [String]
}

struct DoctorDeepResult: Codable {
    let requested: Bool
    let passed: Bool
    let durationMilliseconds: Int?
    let players: Int?
    let fixtures: Int?
    let error: String?

    static let notRequested = DoctorDeepResult(
        requested: false, passed: true, durationMilliseconds: nil,
        players: nil, fixtures: nil, error: nil
    )

    static func passed(durationMilliseconds: Int, players: Int, fixtures: Int) -> DoctorDeepResult {
        DoctorDeepResult(
            requested: true, passed: true, durationMilliseconds: durationMilliseconds,
            players: players, fixtures: fixtures, error: nil
        )
    }

    static func failed(_ error: String) -> DoctorDeepResult {
        DoctorDeepResult(
            requested: true, passed: false, durationMilliseconds: nil,
            players: nil, fixtures: nil, error: error
        )
    }
}


func openManagerRoomWeb() {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = ["https://minsone.github.io/fm26-manager-room/"]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try? process.run()
}
