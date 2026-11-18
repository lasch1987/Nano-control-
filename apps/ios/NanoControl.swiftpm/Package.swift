// swift-tools-version: 5.8

// Abre esta carpeta (NanoControl.swiftpm) con Swift Playgrounds en el iPad o con Xcode en el Mac.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Nano Control",
    platforms: [
        .iOS("16.0")
    ],
    products: [
        .iOSApplication(
            name: "Nano Control",
            targets: ["AppModule"],
            bundleIdentifier: "com.nanocontrol.app",
            displayVersion: "1.0",
            bundleVersion: "1",
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .landscapeRight,
                .landscapeLeft,
                .portrait,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ],
            capabilities: [
                .localNetwork(
                    purposeString: "Nano Control busca tu Mac en la red local para controlar Logic Pro.",
                    bonjourServiceTypes: ["_nanocontrol._tcp"]
                )
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "."
        )
    ]
)
