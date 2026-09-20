param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
& (Join-Path $PSScriptRoot 'prepare-android.ps1')
# Android's CMake toolchain requires an ASCII, space-free path. Map only our new project.
$letter = @('R','S','T','U','V','W','X','Y','Z') | Where-Object { -not (Test-Path ($_ + ':\')) } | Select-Object -First 1
if (-not $letter) { throw 'No unused drive letter for isolated Android build' }
& subst.exe ($letter + ':') $root
if ($LASTEXITCODE -ne 0) { throw 'Unable to map isolated Android build directory' }
$mapped = $letter + ':\'
$old = @{ JAVA_HOME=$env:JAVA_HOME; ANDROID_HOME=$env:ANDROID_HOME; ANDROID_SDK_ROOT=$env:ANDROID_SDK_ROOT; GRADLE_USER_HOME=$env:GRADLE_USER_HOME; PATH=$env:PATH; CI=$env:CI }
try {
  $env:JAVA_HOME = Join-Path $mapped '.runtime\jdk17'
  $env:ANDROID_HOME = Join-Path $mapped '.runtime\android-sdk'
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:GRADLE_USER_HOME = Join-Path $mapped '.runtime\gradle-home'
  $env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
  $manager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
  # Licenses apply only to the private SDK used to build this requested APK.
  (1..100 | ForEach-Object { 'y' }) | & $manager "--sdk_root=$env:ANDROID_HOME" --licenses
  & $manager "--sdk_root=$env:ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1'
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
  $env:CI = '1'
  Push-Location (Join-Path $mapped 'apps\mobile')
  try {
    & npx.cmd expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed' }
    Push-Location android
    try {
      & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a' '--no-daemon' '--max-workers=2' '-Dorg.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8'
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
