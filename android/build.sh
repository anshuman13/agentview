#!/bin/sh
# Runs the unit tests and builds the release APK; with an adb device serial, also installs it there.
# --fast builds the debug APK instead (no R8, a few seconds); test the release build before shipping.
set -e
cd "$(dirname "$0")"
[ -n "$JAVA_HOME" ] || export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$PATH:/opt/homebrew/share/android-commandlinetools/platform-tools"
variant=release
[ "$1" = "--fast" ] && { variant=debug; shift; }
if [ $variant = debug ]; then ./gradlew -q testDebugUnitTest assembleDebug; else ./gradlew -q testDebugUnitTest assembleRelease; fi
apk="$PWD/app/build/outputs/apk/$variant/app-$variant.apk"
[ $variant = debug ] || { mkdir -p ../dist && cp "$apk" ../dist/AgentView.apk; }
echo "$apk"
[ -z "$1" ] || adb -s "$1" install -r "$apk"
