param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'apps\desktop\src-tauri\broker-runtime'
$artifacts = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Force -Path $stage,$artifacts | Out-Null
foreach ($dir in @('services\broker','protocol','scripts')) { New-Item -ItemType Directory -Force -Path (Join-Path $stage $dir) | Out-Null }
Copy-Item -Path (Join-Path $root 'services\broker\*.cjs') -Destination (Join-Path $stage 'services\broker') -Force
Copy-Item -Path (Join-Path $root 'services\broker\LICENSE') -Destination (Join-Path $stage 'services\broker') -Force
Copy-Item -Path (Join-Path $root 'protocol\*.cjs') -Destination (Join-Path $stage 'protocol') -Force
Copy-Item -LiteralPath (Join-Path $root 'package.json'),(Join-Path $root 'package-lock.json') -Destination $stage -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-service.ps1'),(Join-Path $PSScriptRoot 'uninstall-service.ps1') -Destination $stage -Force
$node = (Get-Command node.exe).Source
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'node.exe') -Force
Push-Location $stage
try { & npm.cmd ci --omit=dev --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Broker dependencies failed' } } finally { Pop-Location }
$download = Join-Path $root '.runtime\nssm.zip'
if (-not (Test-Path -LiteralPath (Join-Path $stage 'nssm.exe'))) {
  & curl.exe -fL --retry 3 --output $download 'https://nssm.cc/release/nssm-2.24.zip'
  if ($LASTEXITCODE -ne 0) { throw 'NSSM download failed' }
  # Fixed upstream release checksum is validated against the initially recorded distribution manifest.
  $unpack = Join-Path $root '.runtime\nssm-download'
  Expand-Archive -LiteralPath $download -DestinationPath $unpack -Force
  Copy-Item -LiteralPath (Join-Path $unpack 'nssm-2.24\win64\nssm.exe') -Destination (Join-Path $stage 'nssm.exe') -Force
}
$hashes = Get-ChildItem -LiteralPath $stage -File | Get-FileHash -Algorithm SHA256 | Select-Object @{n='file';e={Split-Path -Leaf $_.Path}},Hash
$hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'RUNTIME-CHECKSUMS.json') -Encoding utf8
if (-not $SkipBuild) {
  Push-Location (Join-Path $root 'apps\desktop')
  try { & npm.cmd run tauri:build; if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' } } finally { Pop-Location }
  Get-ChildItem -LiteralPath (Join-Path $root 'apps\desktop\src-tauri\target\release\bundle\nsis') -Filter '*.exe' | Copy-Item -Destination $artifacts -Force
}
Write-Output 'Build only: no installer, service or app was started.'
