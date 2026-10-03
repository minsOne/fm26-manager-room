import AppKit
import UniformTypeIdentifiers

@MainActor
func chooseCareerSave() -> URL? {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.title = "Select your FM26 career save"
    panel.message = "Manager Room reads only this save. The original file is never modified."
    panel.prompt = "Pin Save"
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.allowsMultipleSelection = false
    panel.allowedContentTypes = [UTType(filenameExtension: "fm") ?? .data]
    panel.directoryURL = SaveSelectionStore.defaultStore().load().map {
        URL(fileURLWithPath: $0.path).deletingLastPathComponent()
    } ?? SaveDirectoryWatcher.defaultFM26Directory()
    guard panel.runModal() == .OK else { return nil }
    return panel.url
}
