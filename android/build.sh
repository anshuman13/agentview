#!/bin/sh
# Runs the unit tests and builds the release APK; with an adb device serial, also installs it there.
set -e
cd "$(dirname "$0")"
[ -n "$JAVA_HOME" ] || export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$PATH:/opt/homebrew/share/android-commandlinetools/platform-tools"
./gradlew -q testDebugUnitTest assembleRelease
apk="$PWD/app/build/outputs/apk/release/app-release.apk"
mkdir -p ../dist && cp "$apk" ../dist/AgentView.apk
echo "$apk"
[ -z "$1" ] || adb -s "$1" install -r "$apk"
