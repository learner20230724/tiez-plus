param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $InstallDir 'broker-runtime'
$node = Join-Path $runtime 'node.exe'
$nssm = Join-Path $runtime 'nssm.exe'
$script = Join-Path $runtime 'services\broker\index.cjs'
foreach ($file in @($node,$nssm,$script)) { if (-not (Test-Path -LiteralPath $file)) { throw "Missing Plus resource: $file" } }
$data = Join-Path $env:ProgramData 'TIEZ Plus\broker'
New-Item -ItemType Directory -Force -Path $data | Out-Null
# LocalService writes its own state; this is NOT an old TieZ data directory.
& icacls.exe $data /inheritance:r /grant '*S-1-5-19:(OI)(CI)M' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to set Plus service data permissions' }
$service = Get-Service -Name 'TiezPlusBroker' -ErrorAction SilentlyContinue
if (-not $service) { & $nssm install TiezPlusBroker $node; if ($LASTEXITCODE -ne 0) { throw 'Unable to install Plus service' } }
function Set-PlusService([string]$Key,[string[]]$Values) {
  & $nssm set TiezPlusBroker $Key @Values | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to configure Plus service: $Key" }
}
Set-PlusService Application @($node)
# NSSM already has an absolute AppDirectory. A relative, whitespace-free entry
# avoids Windows PowerShell 5.1 stripping embedded quotes during native argv marshalling.
Set-PlusService AppParameters @('services\broker\index.cjs')
Set-PlusService AppDirectory @($runtime)
# Read registry values directly: NSSM writes UTF-16 to pipes, which PowerShell 5
# otherwise decodes with embedded NUL characters.
$actualParameters = Get-ItemPropertyValue -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\TiezPlusBroker\Parameters' -Name AppParameters
if ($actualParameters -ne 'services\broker\index.cjs') { throw 'Plus service entrypoint verification failed' }
Set-PlusService ObjectName @('NT AUTHORITY\LocalService')
Set-PlusService DisplayName @('TIEZ Plus Broker')
Set-PlusService Start @('SERVICE_AUTO_START')
Set-PlusService AppExit @('Default','Restart')
Set-PlusService AppRestartDelay @('3000')
Set-PlusService AppEnvironmentExtra @("TIEZ_PLUS_BROKER_DATA=$data")
Set-PlusService AppStdout @((Join-Path $data 'broker.log'))
Set-PlusService AppStderr @((Join-Path $data 'broker-error.log'))
Set-PlusService AppRotateFiles @('1')
Set-PlusService AppRotateOnline @('1')
Set-PlusService AppRotateBytes @('1048576')
Get-NetFirewallRule -Group 'TIEZ Plus' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
# Program-limited rule supports automatically selected TCP fallback ports. Private profile + local subnet only.
New-NetFirewallRule -DisplayName 'TIEZ Plus LAN TCP' -Group 'TIEZ Plus' -Direction Inbound -Action Allow -Profile Private -Program $node -Protocol TCP -RemoteAddress LocalSubnet | Out-Null
New-NetFirewallRule -DisplayName 'TIEZ Plus Discovery UDP' -Group 'TIEZ Plus' -Direction Inbound -Action Allow -Profile Private -Program $node -Protocol UDP -LocalPort 5353,18084 -RemoteAddress LocalSubnet | Out-Null
New-NetFirewallRule -DisplayName 'TIEZ Plus File Transfer' -Group 'TIEZ Plus' -Direction Inbound -Action Allow -Profile Private -Program (Join-Path $InstallDir 'tiez-plus.exe') -Protocol TCP -RemoteAddress LocalSubnet | Out-Null
Start-Service -Name 'TiezPlusBroker'
Write-Output 'Installed TiezPlusBroker. Existing TieZ services and applications were not touched.'
