#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="$PWD/.runtime/jdk17/Contents/Home"
export ANDROID_HOME="$PWD/.runtime/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="$PWD/.runtime/gradle-home"
export PATH="$JAVA_HOME/bin:$PATH"
export CI=1 EXPO_NO_TELEMETRY=1 TIEZ_PLUS_TEST_BUILD=1
mkdir -p .secrets artifacts "$GRADLE_USER_HOME"
chmod 700 .secrets
export TIEZ_PLUS_KEYSTORE="$PWD/.secrets/android-test.keystore"
if [ ! -f .secrets/android-test-password ]; then
  openssl rand -hex 32 > .secrets/android-test-password
  chmod 600 .secrets/android-test-password
fi
export TIEZ_PLUS_STORE_PASSWORD
TIEZ_PLUS_STORE_PASSWORD="$(cat .secrets/android-test-password)"
if [ ! -f "$TIEZ_PLUS_KEYSTORE" ]; then
  keytool -genkeypair -keystore "$TIEZ_PLUS_KEYSTORE" -storetype PKCS12 -storepass:env TIEZ_PLUS_STORE_PASSWORD -keypass:env TIEZ_PLUS_STORE_PASSWORD -alias tiez-plus -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=TIEZ Plus Test'
fi
cd apps/mobile
node node_modules/expo/bin/cli prebuild --platform android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2 --info '-Dorg.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8'
cd ../../..
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk artifacts/TIEZ-Plus-Test-0.1.3-arm64-v8a.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose artifacts/TIEZ-Plus-Test-0.1.3-arm64-v8a.apk
