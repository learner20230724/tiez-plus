import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('desktop startup does not register an updater after its configuration was removed',()=>{
  for(const file of ['main.rs','lib.rs']) assert(!read('apps/desktop/src-tauri/src/'+file).includes('.plugin(tauri_plugin_updater::'));
  assert(!read('apps/desktop/src-tauri/tauri.conf.json').includes('updater:default'));
});
test('early startup errors are persisted and cannot silently exit successfully',()=>{
  const main=read('apps/desktop/src-tauri/src/main.rs');
  assert(main.indexOf('crate::logger::init(startup_log.clone())') < main.indexOf('tauri::Builder::default()'));
  assert.match(main,/show_error_box\("TIEZ Plus 启动失败"/);
  assert.match(main,/std::process::exit\(1\)/);
});
test('double click reveals an existing client; manual startup is not hidden by silent-start preference',()=>{
  const main=read('apps/desktop/src-tauri/src/main.rs');
  assert.match(main,/single_instance::init\(\|app, args, _cwd\|/);
  assert.match(main,/window\.unminimize\(\)/);
  assert.match(main,/focus_clipboard_window\(app\.clone\(\)\)/);
  assert(!read('apps/desktop/src-tauri/src/app/setup.rs').includes('if !is_autostart && !s.silent_start'));
});
test('startup diagnostics disable clipboard paths and hooks while retaining protocol health checks',()=>{
  const plus=read('apps/desktop/src-tauri/src/services/plus/mod.rs');
  assert.match(plus,/sandbox\(\) \|\| diagnostics\(\)/);
  assert.match(plus,/Client::builder\(\)\.no_proxy\(\)/);
  const setup=read('apps/desktop/src-tauri/src/app/setup.rs');
  assert.match(setup,/!crate::services::plus::sandbox\(\) && !crate::services::plus::diagnostics\(\)/);
  assert(setup.indexOf('if crate::services::plus::diagnostics() { return; }') < setup.indexOf('start_clipboard_monitor'));
});
