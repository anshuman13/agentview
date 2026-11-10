#!/bin/sh
# Runs the unit tests and builds the release APK; with an adb device serial, also installs it there and compiles it with speed-profile.
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
pkg=no.pradhan.agentview.native
if [ -n "$1" ]; then
  adb -s "$1" install -r "$apk"
  adb -s "$1" shell am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE "$pkg/androidx.profileinstaller.ProfileInstallReceiver" > /dev/null
  sleep 2
  adb -s "$1" shell cmd package compile -m speed-profile -f "$pkg"
fi
