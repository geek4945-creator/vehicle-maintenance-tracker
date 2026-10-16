#!/usr/bin/env bash
# Build the Android APK (needs JDK 17, Android SDK platform 34 + build-tools 34, Node 18+, internet for first Gradle run).
#   ./scripts/build-apk.sh            -> release APK (signed if a keystore.properties exists, else unsigned)
#   ./scripts/build-apk.sh debug      -> debug APK (signed with the Android debug key, installs fine by sideloading)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"; export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
npm install
node scripts/vendor.js
npx cap sync android
cd android
if [ "${1:-release}" = "debug" ]; then ./gradlew assembleDebug; ls -la app/build/outputs/apk/debug/*.apk
else ./gradlew assembleRelease; ls -la app/build/outputs/apk/release/*.apk; fi
