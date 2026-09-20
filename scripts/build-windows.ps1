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
  # Pin the reviewed 2.24 archive; changed bytes require an explicit source review.
  if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne '727D1E42275C605E0F04ABA98095C38A8E1E46DEF453CDFFCE42869428AA6743') { throw 'NSSM archive checksum mismatch' }
  $unpack = Join-Path $root '.runtime\nssm-download'
  Expand-Archive -LiteralPath $download -DestinationPath $unpack -Force
  Copy-Item -LiteralPath (Join-Path $unpack 'nssm-2.24\win64\nssm.exe') -Destination (Join-Path $stage 'nssm.exe') -Force
}
if ((Get-FileHash -LiteralPath (Join-Path $stage 'nssm.exe') -Algorithm SHA256).Hash -ne 'F689EE9AF94B00E9E3F0BB072B34CAAF207F32DCB4F5782FC9CA351DF9A06C97') { throw 'NSSM executable checksum mismatch' }
$nodeVersion = (& $node --version).Trim()
& curl.exe -fL --retry 3 --output (Join-Path $stage 'NODE-LICENSE.txt') "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE"
if ($LASTEXITCODE -ne 0) { throw 'Node distribution license download failed' }
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $stage 'TIEZ-PLUS-LICENSE.txt') -Force
'NSSM 2.24 - https://nssm.cc/ - Public domain software. Upstream licenses in each node_modules package remain included.' | Set-Content -LiteralPath (Join-Path $stage 'THIRD-PARTY.txt')
$hashes = Get-ChildItem -LiteralPath $stage -File | Where-Object Name -ne "RUNTIME-CHECKSUMS.json" | Get-FileHash -Algorithm SHA256 | Select-Object @{n='file';e={Split-Path -Leaf $_.Path}},Hash
$hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'RUNTIME-CHECKSUMS.json') -Encoding utf8
if (-not $SkipBuild) {
  Push-Location (Join-Path $root 'apps\desktop')
  try { & npm.cmd run tauri:build; if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' } } finally { Pop-Location }
  Get-ChildItem -LiteralPath (Join-Path $root 'apps\desktop\src-tauri\target\release\bundle\nsis') -Filter '*.exe' | Copy-Item -Destination $artifacts -Force
}
Write-Output 'Build only: no installer, service or app was started.'
