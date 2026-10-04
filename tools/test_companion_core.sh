#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
SOURCES="$ROOT/companion/macos/Sources/ManagerRoomCompanion"
swiftc -swift-version 6 -parse-as-library \
  "$SOURCES/CompanionState.swift" "$SOURCES/SnapshotStore.swift" "$SOURCES/SaveSelectionStore.swift" \
  "$SOURCES/AICoach.swift" "$SOURCES/SnapshotValidation.swift" "$SOURCES/NativeParserRunner.swift" \
  "$SOURCES/SaveDirectoryWatcher.swift" "$SOURCES/LocalRequestPolicy.swift" \
  "$ROOT/companion/macos/Tests/CompanionCoreTests.swift" -o "$BUILD/companion-tests"
"$BUILD/companion-tests"
