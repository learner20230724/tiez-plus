import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('application identities and update endpoints are Plus-only',()=>{
  const mobile=JSON.parse(read('apps/mobile/app.json')).expo;
  const desktop=JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
  assert.equal(mobile.android.package,'io.github.learner20230724.tiezplus');
  assert.equal(mobile.scheme,'tiezplus');
  assert.equal(mobile.extra?.eas?.projectId,undefined);
  assert.equal(desktop.identifier,'io.github.learner20230724.tiezplus.desktop');
  assert.equal(desktop.plugins?.updater?.endpoints,undefined);
  assert.match(read('apps/mobile/src/lib/updateChecker.ts'),/const DEFAULT_UPDATE_ENDPOINT = ''/);
  assert(!read('apps/mobile/src/lib/updateChecker.ts').includes('EXPO_PUBLIC_TIEZ_UPDATE_ENDPOINT'));
});
test('active phone text entrypoints do not use old fire-and-forget composer',()=>{
  assert.match(read('apps/mobile/src/navigation/AppNavigator.tsx'),/\.\.\/plus\/PlusHome/);
  const scanner=read('apps/mobile/src/screens/ScannerScreen.tsx');
  assert(!scanner.includes("setInputText('')"));assert(!scanner.includes("'/send_text'"));
  assert.match(scanner,/navigation.navigate\('Home'\)/);
});
test('service scripts and autostart commands cannot target old TieZ',()=>{
  const install=read('scripts/install-service.ps1'),uninstall=read('scripts/uninstall-service.ps1');
  assert(!install.includes('Stop-Process'));assert(!uninstall.includes('Stop-Process'));
  assert(!install.includes('TieZLocalMqttServer'));assert(!uninstall.includes('TieZLocalMqttServer'));
  assert.match(install,/-Profile Private/);assert.match(install,/-RemoteAddress LocalSubnet/);
  const system=read('apps/desktop/src-tauri/src/app/commands/system_cmd.rs');
  assert(!system.includes('key.set_value("TieZ",'));assert(!system.includes('key.delete_value("TieZ")'));assert(!system.includes('key.delete_value("tie-z")'));
});
