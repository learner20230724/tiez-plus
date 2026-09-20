$ErrorActionPreference = 'Stop'
$service = Get-Service -Name 'TiezPlusBroker' -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') { Stop-Service -Name 'TiezPlusBroker'; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(15)) }
  & sc.exe delete TiezPlusBroker | Out-Null
}
Get-NetFirewallRule -Group 'TIEZ Plus' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Output 'Only TiezPlusBroker and Plus firewall rules removed; user data retained.'
