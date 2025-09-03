// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "AICollectionAgentPOC",
    platforms: [
        .iOS(.v14)
    ],
    products: [
        .executable(name: "AICollectionAgentPOC", targets: ["AICollectionAgentPOC"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "AICollectionAgentPOC",
            dependencies: [],
            path: "AICollectionAgentPOC"
        )
    ]
)