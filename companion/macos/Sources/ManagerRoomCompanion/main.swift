import Foundation

enum Command: String {
    case serve, start, stop, probe, parse, coach, candidates
    case snapshotPath = "snapshot-path"
    case selectSave = "select-save"
    case pinSave = "pin-save"
    case unpinSave = "unpin-save"
    case selection, doctor
}

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty || args.first == "--help" || args.first == "help" {
    print("""
    FM26 Manager Room — read-only macOS assistant
    Usage: manager-room <command> [options]
      select-save [path.fm] [--new-career]   Open a file picker or pin the supplied career
      doctor [--deep] [--json] [--online]  Diagnose installation and selected save
      start [--no-open]       Parse selected career, run in background, open browser
      candidates [--query TEXT] [--offset N]  Export a page of external candidates as JSON
      coach --player UID --question "..." --model MODEL [--send]  Preview or send AI context
      stop                   Stop only the managed Companion process
      serve [--open-web]      Foreground service for development
      pin-save <path.fm> | unpin-save | selection | parse <path.fm> | probe
    Service options: --port 8765 --parser <path> --snapshot-file <path.json>
    Web AI: --model MODEL (or OPENAI_MODEL); --enable-web-coach allows confirmed sends with OPENAI_API_KEY
    Selection precedence: --save > --save-dir > persisted pin > default directory
    """)
    exit(0)
}
guard let command = Command(rawValue: args.first ?? "serve") else {
    FileHandle.standardError.write(Data(
        "Unknown command. Use --help for commands.\n".utf8
    ))
    exit(2)
}

do {
let store = try selectedStore(args)
let selectionStore = SaveSelectionStore.defaultStore()
let state = CompanionState()

switch command {
case .candidates:
    guard let selected = selectionStore.load() else { throw CoachError.invalid("Select a career before querying candidates.") }
    let query = option("--query", in: args) ?? ""
    guard query.utf8.count <= 200, let offset = Int(option("--offset", in: args) ?? "0"), (0...250000).contains(offset) else { throw CoachError.invalid("Invalid candidate query or offset.") }
    let work = FileManager.default.temporaryDirectory.appendingPathComponent("mr-candidates-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: work, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: work) }
    let output = SnapshotStore(url: work.appendingPathComponent("snapshot.json"))
    let runner = NativeParserRunner(parserURL: try NativeParserRunner.resolve(explicit: option("--parser", in: args)), store: output, state: state, candidateQuery: query, candidateOffset: offset)
    try runner.parse(saveURL: URL(fileURLWithPath: selected.path))
    var snapshot = try JSONSerialization.jsonObject(with: output.read()) as! [String: Any]
    snapshot["saveId"] = selected.id
    print(String(decoding: try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]), as: UTF8.self))
case .coach:
    guard let selected = selectionStore.load(), let playerID = option("--player", in: args),
          let question = option("--question", in: args) else {
        throw CoachError.invalid("Select a career first, then use coach --player UID --question '...' --model MODEL. Default is local preview; --send explicitly transmits to OpenAI.")
    }
    let model = option("--model", in: args) ?? ProcessInfo.processInfo.environment["OPENAI_MODEL"] ?? ""
    let work = FileManager.default.temporaryDirectory.appendingPathComponent("mr-coach-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: work, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: work) }
    let privateStore = SnapshotStore(url: work.appendingPathComponent("snapshot.json"))
    let runner = NativeParserRunner(parserURL: try NativeParserRunner.resolve(explicit: option("--parser", in: args)), store: privateStore, state: state)
    try runner.parse(saveURL: URL(fileURLWithPath: selected.path))
    let body = try AICoach.requestBody(snapshot: privateStore.read(), playerID: playerID, question: question, model: model)
    if args.contains("--send") {
        let answer = try AICoach.send(body, apiKey: ProcessInfo.processInfo.environment["OPENAI_API_KEY"] ?? "")
        print("AI 생성 해석 · 게임 화면 확인 필요 · 게임 변경 없음\n")
        // JSON quoting prevents terminal escape sequences supplied by a model from executing.
        print(String(decoding: try JSONSerialization.data(withJSONObject: ["answer": answer], options: [.prettyPrinted]), as: UTF8.self))
    } else {
        print("LOCAL PREVIEW ONLY — no request sent. Review this exact context before adding --send.\n")
        print(String(decoding: body, as: UTF8.self))
    }
case .probe:
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(FMProcessProbe.probe())
    print(String(decoding: data, as: UTF8.self))

case .snapshotPath:
    print(store.url.path)

case .selectSave, .pinSave:
    let path = args.count >= 2 && !args[1].hasPrefix("--") ? args[1] : nil
    guard command == .selectSave || path != nil else {
        FileHandle.standardError.write(Data(
            "Usage: manager-room-companion pin-save /path/to/Career.fm\n".utf8
        ))
        exit(2)
    }
    guard let save = path.map({ URL(fileURLWithPath: $0) }) ?? chooseCareerSave() else {
        print("Selection cancelled. Previous career retained.")
        exit(0)
    }
    let selected = try ServiceControl.installed.withLock {
        try ServiceControl.installed.requireStopped()
        return try selectionStore.pin(save, newCareer: args.contains("--new-career"))
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    print(String(decoding: try encoder.encode(selected), as: UTF8.self))

case .unpinSave:
    try ServiceControl.installed.withLock {
        try ServiceControl.installed.requireStopped()
        try selectionStore.clear()
    }
    print("Pinned save cleared.")

case .selection:
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let selected = selectionStore.load() {
        print(String(decoding: try encoder.encode(selected), as: UTF8.self))
    } else {
        print("{}")
    }

case .stop:
    try ServiceControl.installed.stop()

case .start:
    if args.contains("--port") && (parsePort(args) ?? 0) == 0 {
        throw CLIError(message: "--port must be an integer from 1 to 65535.")
    }
    try ServiceControl.installed.start(arguments: args, port: parsePort(args) ?? 8765)

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

    if args.contains("--port") && (parsePort(args) ?? 0) == 0 {
        throw CLIError(message: "--port must be an integer from 1 to 65535.")
    }
    let port = parsePort(args) ?? 8765
    let selectedExists = selected.map { FileManager.default.fileExists(atPath: $0.path) }
    let saveReadable = selected.map { FileManager.default.isReadableFile(atPath: $0.path) } ?? false
    let writable = LocalDiagnostics.snapshotWritable(store)
    let api = LocalDiagnostics.health(port: port)
    let portFree = LocalDiagnostics.portAvailable(port)
    let version = ProcessInfo.processInfo.operatingSystemVersion
    let platformOK = version.majorVersion >= 13
    let online = args.contains("--online")
    let webOK = online ? LocalDiagnostics.webReachable() : nil
    let running = FMProcessProbe.probe().running
    let installOnly = args.contains("--installation-only")
    let installationHealthy = parserURL != nil && writable && platformOK
    let healthy = installationHealthy && (installOnly || (selectedExists == true && saveReadable))
        && (portFree || api?["status"] as? String == "ok")
        && !(api?["lastParseError"] is String)
        && (!deep || deepResult.passed)
    var checks: [DoctorCheck] = [
        .init(name: "macOS", status: platformOK ? "OK" : "FAIL", detail: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion); requires macOS 13+"),
        .init(name: "Architecture", status: "OK", detail: LocalDiagnostics.architecture),
        .init(name: "Rust parser", status: parserURL != nil ? "OK" : "FAIL", detail: parserURL?.path ?? "Re-run ./install.sh or supply --parser."),
        .init(name: "Companion", status: "OK", detail: Bundle.main.executableURL?.path ?? CommandLine.arguments[0]),
        .init(name: "FM save directory", status: FileManager.default.fileExists(atPath: defaultDirectory.path) ? "OK" : "INFO", detail: "Custom locations are supported via select-save."),
        .init(name: "Pinned Save", status: selected != nil ? "OK" : (installOnly ? "INFO" : "FAIL"), detail: selected?.path ?? "Run manager-room select-save."),
        .init(name: "Save Read", status: saveReadable ? "OK" : (installOnly && selected == nil ? "INFO" : "FAIL"), detail: saveReadable ? "Readable; original save is never modified." : "Re-select a readable .fm file. Check Terminal permissions in Privacy & Security."),
        .init(name: "Snapshot Write", status: writable ? "OK" : "FAIL", detail: writable ? store.url.path : "Check permissions for \(store.url.deletingLastPathComponent().path)."),
        .init(name: "Localhost port", status: portFree || api != nil ? "OK" : "FAIL", detail: portFree ? "\(port) available" : (api != nil ? "\(port) serving Manager Room" : "Port \(port) occupied; choose --port or stop the owning service.")),
        .init(name: "Local API", status: api?["lastParseError"] is String ? "FAIL" : (api != nil ? "OK" : "INFO"), detail: api?["lastParseError"] as? String ?? (api != nil ? "Health endpoint responding." : "Not running; use manager-room start.")),
        .init(name: "GitHub Pages", status: webOK == nil ? "INFO" : (webOK == true ? "OK" : "WARN"), detail: webOK == nil ? "Run doctor --online to check connectivity." : "Network probe only; browser permission/CORS must be verified in your browser."),
        .init(name: "FM26 Running", status: "INFO", detail: running ? "Running; runtime bridge remains unavailable." : "Not running; saved careers can still be parsed."),
        .init(name: "Parser test", status: deep ? (deepResult.passed ? "OK" : "FAIL") : "INFO", detail: deep ? (deepResult.error ?? "\(deepResult.players ?? 0) players; \(deepResult.durationMilliseconds ?? 0) ms (this machine)") : "Run doctor --deep to validate the pinned save privately.")
    ]
    if !notes.isEmpty { checks.append(.init(name: "Guidance", status: "INFO", detail: notes.joined(separator: " "))) }
    let report = DoctorReport(
        platform: "macOS", healthy: healthy, installationHealthy: installationHealthy,
        parserAvailable: parserURL != nil, parserPath: parserURL?.path,
        snapshotPath: store.url.path, snapshotExists: store.exists,
        selectionId: selected?.id, selectedSavePath: selected?.path, selectedSaveExists: selectedExists,
        defaultSaveDirectory: defaultDirectory.path,
        defaultSaveDirectoryExists: FileManager.default.fileExists(atPath: defaultDirectory.path),
        webURL: "https://minsone.github.io/fm26-manager-room/", deep: deepResult, notes: notes, checks: checks
    )
    if args.contains("--json") {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        print(String(decoding: try encoder.encode(report), as: UTF8.self))
    } else {
        print("Manager Room Doctor")
        for check in checks { print("\(check.name.padding(toLength: 19, withPad: " ", startingAt: 0)) \(check.status.padding(toLength: 5, withPad: " ", startingAt: 0)) \(check.detail)") }
        print(healthy ? (installOnly ? "INSTALLED — select-save before start" : "READY — browser connection and running-FM watcher still need real-Mac verification") : "NEEDS ATTENTION — follow the FAIL guidance above")
    }
    if !healthy { exit(4) }

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
    let server = try LocalHTTPServer(port: port, store: store, companionState: state,
                                     instanceID: option("--service-instance", in: args),
                                     coachModel: option("--model", in: args) ?? ProcessInfo.processInfo.environment["OPENAI_MODEL"] ?? "",
                                     coachKey: ProcessInfo.processInfo.environment["OPENAI_API_KEY"] ?? "",
                                     enableWebCoach: args.contains("--enable-web-coach"))
    server.start()

    let shouldOpenWeb = args.contains("--open-web")
    if shouldOpenWeb {
        openManagerRoomWeb(port: port)
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
    if shouldOpenWeb {
        print("Opening Manager Room in the default browser.")
    }

    withExtendedLifetime((server, watcher)) {
        RunLoop.main.run()
    }
}

} catch {
    FileHandle.standardError.write(Data("Manager Room: \(error.localizedDescription)\n".utf8))
    exit(4)
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


struct DoctorCheck: Codable {
    let name: String
    let status: String
    let detail: String
}

struct DoctorReport: Codable {
    let platform: String
    let healthy: Bool
    let installationHealthy: Bool
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
    let checks: [DoctorCheck]
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


func openManagerRoomWeb(port: UInt16 = 8765) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = ["https://minsone.github.io/fm26-manager-room/?bridge=http%3A%2F%2F127.0.0.1%3A\(port)"]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try? process.run()
}
