param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
& (Join-Path $PSScriptRoot 'prepare-android.ps1')
& (Join-Path $PSScriptRoot 'prepare-node.ps1')
# Android's CMake toolchain requires an ASCII, space-free path. Map only our new project.
$letter = @('R','S','T','U','V','W','X','Y','Z') | Where-Object { -not (Test-Path ($_ + ':\')) } | Select-Object -First 1
if (-not $letter) { throw 'No unused drive letter for isolated Android build' }
& subst.exe ($letter + ':') $root
if ($LASTEXITCODE -ne 0) { throw 'Unable to map isolated Android build directory' }
$mapped = $letter + ':\'
$old = @{ JAVA_HOME=$env:JAVA_HOME; ANDROID_HOME=$env:ANDROID_HOME; ANDROID_SDK_ROOT=$env:ANDROID_SDK_ROOT; GRADLE_USER_HOME=$env:GRADLE_USER_HOME; PATH=$env:PATH; CI=$env:CI; JAVA_OPTS=$env:JAVA_OPTS; EXPO_NO_TELEMETRY=$env:EXPO_NO_TELEMETRY; TEMP=$env:TEMP; TMP=$env:TMP; NODE_OPTIONS=$env:NODE_OPTIONS; TIEZ_PLUS_BUILD_ROOT=$env:TIEZ_PLUS_BUILD_ROOT; TIEZ_PLUS_BUILD_DRIVE=$env:TIEZ_PLUS_BUILD_DRIVE }
try {
  $env:TIEZ_PLUS_BUILD_ROOT = $root; $env:TIEZ_PLUS_BUILD_DRIVE = $mapped
  $env:NODE_OPTIONS = "$env:NODE_OPTIONS --preserve-symlinks --preserve-symlinks-main --require=$(Join-Path $mapped 'scripts\mapped-paths.cjs')"
  $env:TEMP = Join-Path $mapped '.runtime\android-temp'; $env:TMP = $env:TEMP
  New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
  $env:JAVA_HOME = Join-Path $mapped '.runtime\jdk17'
  $env:ANDROID_HOME = Join-Path $mapped '.runtime\android-sdk'
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:GRADLE_USER_HOME = Join-Path $mapped '.runtime\gradle-home'
  $env:PATH = (Join-Path $mapped '.runtime\node22') + ';' + (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
  $manager = Join-Path $env:ANDROID_HOME 'cmdline-tools\19.0\bin\sdkmanager.bat'
  $proxyArgs = @()
  if ($env:HTTPS_PROXY) {
    $proxy = [uri]$env:HTTPS_PROXY
    if ($proxy.Scheme -eq 'http') {
      $proxyArgs = @('--proxy=http',"--proxy_host=$($proxy.Host)","--proxy_port=$($proxy.Port)")
      $env:JAVA_OPTS = "$env:JAVA_OPTS -Dhttp.proxyHost=$($proxy.Host) -Dhttp.proxyPort=$($proxy.Port) -Dhttps.proxyHost=$($proxy.Host) -Dhttps.proxyPort=$($proxy.Port)"
      New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME | Out-Null
      @("systemProp.http.proxyHost=$($proxy.Host)","systemProp.http.proxyPort=$($proxy.Port)","systemProp.https.proxyHost=$($proxy.Host)","systemProp.https.proxyPort=$($proxy.Port)",'systemProp.http.nonProxyHosts=localhost|127.*') | Set-Content -LiteralPath (Join-Path $env:GRADLE_USER_HOME 'gradle.properties') -Encoding ascii
    }
  }
  # Licenses apply only to the private SDK used to build this requested APK.
  (1..100 | ForEach-Object { 'y' }) | & $manager @proxyArgs "--sdk_root=$env:ANDROID_HOME" --licenses
  & $manager @proxyArgs "--sdk_root=$env:ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'build-tools;35.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1'
  if ($LASTEXITCODE -ne 0) { throw 'Private Android SDK package installation failed' }
  if ($PrepareOnly) { return }
  $secrets = Join-Path $mapped '.secrets'
  New-Item -ItemType Directory -Force -Path $secrets | Out-Null
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $secrets /inheritance:r /grant "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  $passwordFile = Join-Path $secrets 'android-signing-password.txt'
  if (-not (Test-Path -LiteralPath $passwordFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [IO.File]::WriteAllText($passwordFile,([BitConverter]::ToString($bytes)).Replace('-',''))
  }
  $env:TIEZ_PLUS_STORE_PASSWORD = [IO.File]::ReadAllText($passwordFile)
  $env:TIEZ_PLUS_KEYSTORE = Join-Path $secrets 'tiez-plus-release.keystore'
  if (-not (Test-Path -LiteralPath $env:TIEZ_PLUS_KEYSTORE)) {
    & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $env:TIEZ_PLUS_KEYSTORE -storetype PKCS12 -storepass:env TIEZ_PLUS_STORE_PASSWORD -keypass:env TIEZ_PLUS_STORE_PASSWORD -alias tiez-plus -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=TIEZ Plus, OU=Personal Software, O=TIEZ Plus'
    if ($LASTEXITCODE -ne 0) { throw 'Independent APK signing key creation failed' }
  }
  $env:CI = '1'; $env:EXPO_NO_TELEMETRY = '1'
  Push-Location (Join-Path $mapped 'apps\mobile')
  try {
    & node.exe node_modules/expo/bin/cli prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed' }
    & node.exe (Join-Path $mapped 'scripts\normalize-autolinking.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Unable to normalize private autolinking cache' }
    Push-Location android
    try {
      & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a' '--init-script' (Join-Path $mapped 'scripts\android-paths.init.gradle') '--no-daemon' '--max-workers=2' '-Dorg.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8'
      if ($LASTEXITCODE -ne 0) { throw 'Android release build failed' }
    } finally { Pop-Location }
    $artifact = Join-Path $mapped 'artifacts\TIEZ-Plus-0.1.0-arm64-v8a.apk'
    Copy-Item -LiteralPath 'android\app\build\outputs\apk\release\app-release.apk' -Destination $artifact -Force
    & (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat') verify --verbose $artifact
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
  } finally { Pop-Location }
} finally {
  foreach ($key in $old.Keys) { [Environment]::SetEnvironmentVariable($key,$old[$key],'Process') }
  $env:TIEZ_PLUS_STORE_PASSWORD = $null; $env:TIEZ_PLUS_KEYSTORE = $null
  # Release only the mapping created above, never an existing user drive.
  & subst.exe ($letter + ':') /D
}
Write-Output 'Android build only; no ADB connection or installation performed.'
