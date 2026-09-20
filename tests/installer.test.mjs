import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const hook=fs.readFileSync(new URL('../apps/desktop/src-tauri/nsis/plus.nsh',import.meta.url),'utf8');
const line=hook.split(/\r?\n/).find(line=>line.includes('nsExec::ExecToStack') && line.includes(' -Command '));
assert(line, 'Production PREINSTALL command must exist');
// Test the command from the real hook, not a reimplementation. Decode NSIS $$.
const command=line.match(/ -Command "(.*)"'$/)[1].replaceAll('$$','$');
const shell=path.join(process.env.WINDIR || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const cases=[
  {name:'first install / service absent',status:'missing',code:0,stop:false,wait:false},
  {name:'already stopped',status:'Stopped',code:0,stop:false,wait:false},
  {name:'running upgrade',status:'Running',code:0,stop:true,wait:true},
  {name:'already stopping',status:'StopPending',code:0,stop:false,wait:true},
  {name:'query denied is not mistaken for absence',status:'query-denied',code:1,error:'QUERY_DENIED',stop:false,wait:false},
  {name:'stop denied',status:'stop-denied',code:1,error:'STOP_DENIED',stop:false,wait:false},
  {name:'wait timed out',status:'timeout',code:1,error:'WAIT_TIMEOUT',stop:true,wait:false},
];
for(const scenario of cases) test(`installer PREINSTALL: ${scenario.name}`,{skip:process.platform!=='win32'},()=>{
  // Functions fully shadow service cmdlets: never query or stop a real service.
  const mocks=`
    $ProgressPreference='SilentlyContinue';
    Add-Type -AssemblyName System.ServiceProcess;
    $scenario='${scenario.status}';
    function Get-Service {
      param($Name,$ErrorAction)
      if ($Name -ne 'TiezPlusBroker') { throw 'WRONG_SERVICE' }
      if ($scenario -eq 'missing') { Write-Error 'NOT_INSTALLED' -Category ObjectNotFound -ErrorAction Stop }
      if ($scenario -eq 'query-denied') { Write-Error 'QUERY_DENIED' -Category PermissionDenied -ErrorAction Stop }
      $state = if ($scenario -in @('stop-denied','timeout')) { 'Running' } else { $scenario }
      $item=[pscustomobject]@{Name='TiezPlusBroker';Status=[System.ServiceProcess.ServiceControllerStatus]::$state}
      $item | Add-Member -MemberType ScriptMethod -Name WaitForStatus -Value {
        param($Expected,$Timeout)
        if ($Expected -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped -or $Timeout.TotalSeconds -ne 20) { throw 'WRONG_WAIT' }
        if ($scenario -eq 'timeout') { throw 'WAIT_TIMEOUT' }
        Write-Output 'WAIT_CONFIRMED'
      }
      return $item
    }
    function Stop-Service {
      param($InputObject,$ErrorAction)
      if ($InputObject.Name -ne 'TiezPlusBroker') { throw 'WRONG_SERVICE' }
      if ($scenario -eq 'stop-denied') { throw 'STOP_DENIED' }
      Write-Output 'STOP_CALLED'
    }
  `;
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(mocks+'\n'+command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.ifError(result.error);
  assert.equal(result.status,scenario.code,result.stdout+result.stderr);
  assert.equal(result.stdout.includes('STOP_CALLED'),scenario.stop);
  assert.equal(result.stdout.includes('WAIT_CONFIRMED'),scenario.wait);
  if(scenario.error) assert(result.stdout.includes(scenario.error),result.stdout);
});
test('installer logs actual diagnostics instead of always alleging a stop failure',()=>{
  assert.match(hook,/TIEZ-Plus-install\.log/);
  assert.match(hook,/PlusInstallCheckLog "PREINSTALL"/);
  assert.match(hook,/PlusInstallCheckLog "POSTINSTALL"/);
  assert(!hook.includes('Cannot stop TiezPlusBroker'));
});
