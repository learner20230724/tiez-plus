$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$jdkRoot = Join-Path $runtime 'jdk17'
if (-not (Test-Path (Join-Path $jdkRoot 'bin\java.exe'))) {
  $asset = (Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows')[0]
  $zip = Join-Path $runtime 'jdk17.zip'
  & curl.exe -fL --retry 3 --output $zip $asset.binary.package.link
  if ($LASTEXITCODE -ne 0) { throw 'JDK download failed' }
  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.binary.package.checksum) { throw 'JDK checksum mismatch' }
  $unpack = Join-Path $runtime 'jdk-download'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  $jdk = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
  # Copy only into the new project; never change the system Java installation.
  Copy-Item -LiteralPath $jdk.FullName -Destination $jdkRoot -Recurse -Force
}
$sdk = Join-Path $runtime 'android-sdk'
if (-not (Test-Path (Join-Path $sdk 'cmdline-tools\19.0\bin\sdkmanager.bat'))) {
  $repo = [xml](Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-1.xml').Content
  $pkg = $repo.SelectNodes("//*[local-name()='remotePackage']") | Where-Object { $_.path -eq 'cmdline-tools;19.0' } | Select-Object -First 1
  $archive = $pkg.archives.archive | Where-Object { $_.'host-os' -eq 'windows' } | Select-Object -First 1
  if (-not $archive) { throw 'Android command-line tools metadata not found' }
  $zip = Join-Path $runtime 'android-tools19.zip'
  & curl.exe -fL --retry 3 --output $zip ('https://dl.google.com/android/repository/' + $archive.complete.url)
  if ($LASTEXITCODE -ne 0) { throw 'Android tools download failed' }
  $algorithm = if ($archive.complete.checksum.type) { $archive.complete.checksum.type.Replace('-','') } else { 'SHA1' }
  $expected = $archive.complete.checksum.InnerText
  if (-not $expected) { $expected = [string]$archive.complete.checksum }
  if ((Get-FileHash -LiteralPath $zip -Algorithm $algorithm).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { throw 'Android tools checksum mismatch' }
  $unpack = Join-Path $runtime 'sdk19-download'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $sdk 'cmdline-tools') | Out-Null
  Copy-Item -LiteralPath (Join-Path $unpack 'cmdline-tools') -Destination (Join-Path $sdk 'cmdline-tools\19.0') -Recurse -Force
}
Write-Output "Private JDK: $jdkRoot"
Write-Output "Private SDK: $sdk"
