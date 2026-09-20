$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$nodeDir = Join-Path $runtime 'node22'
if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $release = $releases | Where-Object { $_.version -match '^v22\.' -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
  if (-not $release) { throw 'No official Windows Node 22 distribution found' }
  $file = "node-$($release.version)-win-x64.zip"
  $base = "https://nodejs.org/dist/$($release.version)"
  $manifest = (Invoke-WebRequest "$base/SHASUMS256.txt").Content
  $entry = $manifest -split "`n" | Where-Object { $_.Trim().EndsWith('  '+$file) } | Select-Object -First 1
  if (-not $entry) { throw 'Node checksum manifest entry missing' }
  $expected = ($entry.Trim() -split '\s+')[0]
  $zip = Join-Path $runtime 'node22.zip'
  & curl.exe -fL --retry 3 --output $zip "$base/$file"
  if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node download or checksum verification failed' }
  $unpack = Join-Path $runtime 'node22-download'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  Copy-Item -LiteralPath (Join-Path $unpack "node-$($release.version)-win-x64") -Destination $nodeDir -Recurse -Force
  [IO.File]::WriteAllText((Join-Path $nodeDir 'DISTRIBUTION.txt'),"$base/$file`nSHA256 $expected`n")
}
Write-Output "Private Node build runtime: $nodeDir"
