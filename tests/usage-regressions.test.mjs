import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('phone clipboard import exists only in explicit push pull-to-refresh',()=>{
  const s=read('apps/mobile/src/plus/PlusHome.tsx');
  assert.equal((s.match(/await captureClipboard\(\)/g)||[]).length,1);
  const refresh=s.slice(s.indexOf('async function refresh()'),s.indexOf('async function copy('));
  assert.match(refresh,/if\(mode==='pull'\)/);
  assert.match(refresh,/await flush\(\);await captureClipboard\(\)/);
  const lifecycle=s.slice(s.indexOf('const boot='));
  assert(!lifecycle.includes('captureClipboard()'));
  assert.match(lifecycle,/setSelected\(\[\]\)/);
  assert.match(s,/setSelected\(ids=>content.length/);
});

test('header has explicit drag handler and inline status, excluding interactive targets',()=>{
  const app=read('apps/desktop/src/App.tsx');
  const header=read('apps/desktop/src/features/app/components/AppHeader.tsx');
  assert(!app.includes('<PlusStatus'));
  assert.match(header,/onMouseDown=\{startHeaderDrag\}/);
  assert.match(header,/getCurrentWindow\(\).startDragging\(\)/);
  assert.match(header,/closest\('button,input,textarea,select,a,\[role="dialog"\],.window-no-drag'\)/);
  assert.match(header,/<\/span>\s*<PlusStatus/);
});

test('Win+V hydration does not run again on unrelated settings callbacks',()=>{
  const hook=read('apps/desktop/src/shared/hooks/useSettingsPostInit.ts');
  assert.match(hook,/\[persistedWinV, setRegistryWinVEnabled\]/);
  assert.equal((hook.match(/setRegistryWinVEnabled\(/g)||[]).length,1);
  const backend=read('apps/desktop/src-tauri/src/app/commands/hotkey_cmd.rs');
  assert.match(backend,/is_registered\(shortcut.clone\(\)\)/);
  assert.match(backend,/register_shortcut\(app_handle, &main_hotkey\)\?/);
  const startup=read('apps/desktop/src-tauri/src/app/setup.rs');
  assert.match(startup,/main_hotkey: if repo.get\("app.use_win_v_shortcut"\)/);
});

test('background receiver remains native, bounded, and independent of window visibility',()=>{
  const session=read('apps/desktop/src-tauri/src/services/plus/session.rs');
  assert(!session.includes('is_visible')&&!session.includes('is_focused'));
  assert.match(session,/mpsc::channel::<Request>\(32\)/);
  assert.match(session,/tokio::spawn\(async move/);
  assert.match(session,/impl Drop for Pump/);
  assert.match(session,/tx.try_send\(r\)/);
  const main=read('apps/desktop/src-tauri/src/main.rs');
  assert.match(main,/ExitRequested \{ code: None, api, .. \} => api.prevent_exit\(\)/);
  const runtime=read('apps/mobile/src/plus/runtime.ts');
  assert.match(runtime,/void recoverPending\(c\)/);
  assert.match(runtime,/generation === connectionGeneration/);
});
