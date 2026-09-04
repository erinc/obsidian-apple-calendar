// swift-tools-version: 5.9
import PackageDescription

let package_ = Package(
  name: "apple-calendar-helper",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(
      name: "apple-calendar-helper",
      path: "Sources/apple-calendar-helper"
    ),
  ]
)
