// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ManagerRoomCompanion",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "manager-room-companion", targets: ["ManagerRoomCompanion"])
    ],
    targets: [
        .executableTarget(
            name: "ManagerRoomCompanion",
            path: "Sources/ManagerRoomCompanion"
        )
    ]
)
