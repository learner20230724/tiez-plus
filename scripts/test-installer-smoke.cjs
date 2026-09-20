'use strict';
// Headless NSIS -> nsExec -> 64-bit PowerShell smoke test. This helper never
// installs files/services, accesses a clipboard, or calls real service cmdlets.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
if (process.platform !== 'win32') throw new Error('Windows-only NSIS test');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.runtime', 'installer-smoke');
fs.mkdirSync(path.join(dir, 'tmp'), {recursive: true});
const hook = fs.readFileSync(path.join(root, 'apps/desktop/src-tauri/nsis/plus.nsh'), 'utf8');
const line = hook.split(/\r?\n/).find(s => s.includes('nsExec::ExecToStack') && s.includes(' -Command '));
if (!line) throw new Error('Missing production PREINSTALL command');
const mocks = 'function Get-Service { param($$Name,$$ErrorAction); Write-Error -Message NOT_INSTALLED -Category ObjectNotFound -ErrorAction Stop }; function Stop-Service { throw SHOULD_NOT_STOP }; ';
const mocked = line.replace(' -Command "', () => ' -Command "' + mocks);
const exe = path.join(dir, 'preinstall-smoke.exe');
const script = `Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
OutFile "${exe}"
!include LogicLib.nsh
Section
${mocked}
Pop $0
Pop $1
FileOpen $2 "$EXEDIR\\result.txt" w
FileWrite $2 "exit=$0$\\r$\\n$1$\\r$\\n"
FileClose $2
\${If} $0 != 0
  SetErrorLevel 1
\${Else}
  SetErrorLevel 0
\${EndIf}
SectionEnd
`;
const nsi = path.join(dir, 'preinstall-smoke.nsi');
fs.writeFileSync(nsi, '\ufeff' + script, 'utf16le');
const compiler = path.join(process.env.LOCALAPPDATA, 'tauri', 'NSIS', 'makensis.exe');
function run(file, args) {
  const r = spawnSync(file, args, {cwd:dir,windowsHide:true,encoding:'utf8',timeout:40000,env:{...process.env,TEMP:path.join(dir,'tmp'),TMP:path.join(dir,'tmp')}});
  if(r.error || r.status !== 0) throw new Error(`${file}: ${r.error || r.stdout + r.stderr}`);
}
run(compiler, ['/V2', nsi]);
run(exe, ['/S']);
const output = fs.readFileSync(path.join(dir, 'result.txt'), 'utf8');
if (!output.startsWith('exit=0')) throw new Error(output);
console.log('PASS: 32-bit NSIS / nsExec / Sysnative PowerShell accepts missing Plus service; no installation or real service access.');
