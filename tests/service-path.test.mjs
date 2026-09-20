import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const install=fs.readFileSync(new URL('../scripts/install-service.ps1',import.meta.url),'utf8');
test('NSSM uses a whitespace-free relative entrypoint and an explicit working directory',()=>{
  assert.match(install,/Set-PlusService AppParameters @\('services\\broker\\index\.cjs'\)/);
  assert.match(install,/Set-PlusService AppDirectory @\(\$runtime\)/);
  assert.match(install,/Get-ItemPropertyValue.*-Name AppParameters/);
  assert(!install.includes('& $nssm get TiezPlusBroker AppParameters'));
});
test('Windows PowerShell 5 launches the actual Node executable from a spaced Unicode directory',{skip:process.platform!=='win32'},()=>{
  const dir=fs.mkdtempSync(path.resolve('.runtime/Program Files 中文 Plus '));
  const entry=install.match(/Set-PlusService AppParameters @\('([^']+)'\)/)[1];
  const entryFile=path.join(dir,...entry.split('\\'));
  fs.mkdirSync(path.dirname(entryFile),{recursive:true});
  fs.writeFileSync(entryFile,'process.stdout.write(JSON.stringify({cwd:process.cwd(),file:__filename}));');
  const fixture=path.join(dir,'launch.ps1');
  fs.writeFileSync(fixture,'param($NodePath,$WorkingDir,$Entry)\r\nSet-Location -LiteralPath $WorkingDir\r\n& $NodePath $Entry\r\nexit $LASTEXITCODE\r\n');
  try {
    const shell=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture,'-NodePath',process.execPath,'-WorkingDir',dir,'-Entry',entry],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.ifError(result.error); assert.equal(result.status,0,result.stderr);
    const output=JSON.parse(result.stdout);
    assert.equal(output.cwd.toLowerCase(),dir.toLowerCase());
    assert.equal(output.file.toLowerCase(),entryFile.toLowerCase());
  } finally {
    const base=path.resolve('.runtime')+path.sep;
    assert(dir.startsWith(base)); fs.rmSync(dir,{recursive:true,force:true});
  }
});
