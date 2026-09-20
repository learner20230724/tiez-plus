$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'artifacts'
$files = Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Extension -in '.exe','.apk' } | Sort-Object Name
if (-not $files) { throw 'No installable Plus artifacts found' }
$lines = $files | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$_.Name }
[IO.File]::WriteAllLines((Join-Path $dir 'SHA256SUMS.txt'),[string[]]$lines,(New-Object Text.UTF8Encoding($false)))
$lines
