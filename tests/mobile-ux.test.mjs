import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import storage from '../apps/mobile/src/plus/store.ts';
import actions from '../apps/mobile/src/plus/actions.ts';
const target={instanceId:'server',desktopId:'desktop'};
const draft=(id,content,kind='input')=>({id,content,kind,revision:1,updated_at:1});
async function setup(t,legacy=false) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  if(legacy)db.exec(`CREATE TABLE plus_drafts(id TEXT PRIMARY KEY,content TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    INSERT INTO plus_drafts VALUES('old','旧草稿  🙂',7,1);
    CREATE TABLE plus_outbox(id TEXT PRIMARY KEY,content TEXT NOT NULL,draft_id TEXT,draft_revision INTEGER NOT NULL,
      target_instance TEXT NOT NULL,target_device TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,delivered_at INTEGER,error TEXT,attempts INTEGER NOT NULL DEFAULT 0);
    INSERT INTO plus_outbox VALUES('old-message','旧版未确认文字  🙂',NULL,3,'server','desktop','unconfirmed',1,NULL,'等待回执',1);`);
  const adapter={execAsync:async q=>db.exec(q),runAsync:async(q,...p)=>db.prepare(q).run(...p),getFirstAsync:async(q,...p)=>db.prepare(q).get(...p)??null,getAllAsync:async(q,...p)=>db.prepare(q).all(...p)};
  const store=new storage.PlusStore(adapter,randomUUID);await store.init();return {store,db,adapter};
}
test('mobile update migrates the old SQLite draft schema without losing text',async t=>{
  const {store}=await setup(t,true);const old=(await store.drafts())[0];
  assert.equal(old.content,'旧草稿  🙂');assert.equal(old.revision,7);assert.equal(old.kind,'input');
  const record=await store.getRecord('old-message');assert.equal(record.content,'旧版未确认文字  🙂');assert.equal(record.status,'unconfirmed');assert.equal(record.attempts,1);
  await store.init();assert.equal((await store.drafts()).length,1);
});

test('Android packaging reads UTF-8 version metadata and does not overwrite the previous APK',()=>{
  const build=fs.readFileSync(new URL('../scripts/build-android.ps1',import.meta.url),'utf8');
  const line=build.split(/\r?\n/).find(line=>line.trim().startsWith('$version ='));
  assert.match(line,/-Encoding utf8/);assert.match(build,/TIEZ-Plus-\$version-arm64-v8a\.apk/);
  const app=JSON.parse(fs.readFileSync(new URL('../apps/mobile/app.json',import.meta.url),'utf8'));
  const pkg=JSON.parse(fs.readFileSync(new URL('../apps/mobile/package.json',import.meta.url),'utf8'));
  assert.equal(app.expo.version,pkg.version);assert(app.expo.android.versionCode>1);
  if(process.platform==='win32') {
    const actual=execFileSync('powershell.exe',['-NoProfile','-Command',line.trim()+'; [Console]::Write($version)'],{cwd:fileURLToPath(new URL('../apps/mobile/',import.meta.url)),encoding:'utf8'});
    assert.equal(actual,app.expo.version);
  }
});
test('push archives complete originals before clearing selected inputs, without claiming delivery',async t=>{
  const {store}=await setup(t);const a=draft('a','  长文字🙂\n'.repeat(10000)),b=draft('b','未选中'),clip=draft('clip','当前剪贴板','clipboard');
  await store.saveDraft(b);const rows=await store.prepare([a,clip],target,true);
  assert.equal(rows[0].content,a.content);assert.equal(rows[0].status,'saved');
  const saved=await store.drafts();assert.equal(saved.find(d=>d.id==='a').content,'');assert.equal(saved.find(d=>d.id==='b').content,b.content);assert.equal(saved.find(d=>d.id==='clip').content,clip.content);
  await store.markUnconfirmed(rows[0].id,'offline');assert.equal((await store.getRecord(rows[0].id)).content,a.content);
  await store.applyResult(rows[1].id,target,'delivered');assert.equal((await store.drafts()).find(d=>d.id==='clip').content,clip.content);
});
test('archive failure rolls back all clearing; saving to history is mandatory',async t=>{
  const {store,adapter}=await setup(t);const a=draft('a','保留全部');await store.saveDraft(a);
  const run=adapter.runAsync;adapter.runAsync=async(q,...p)=>{if(q.startsWith('INSERT INTO plus_outbox'))throw Error('disk full');return run(q,...p);};
  await assert.rejects(store.prepare([a],target,true));assert.equal((await store.drafts())[0].content,a.content);assert.equal((await store.history()).length,0);
});
test('archive commit and late ACK do not erase text edited during submission',async t=>{
  const {store}=await setup(t);const original=draft('a','old'),edited={...original,content:'new',revision:2};
  await store.saveDraft(edited);const [out]=await store.prepare([original],target,true);
  assert.equal((await store.drafts())[0].content,'new');await store.applyResult(out.id,target,'delivered');assert.equal((await store.drafts())[0].content,'new');
  assert.equal(actions.clearArchivedDrafts([edited],[original]).drafts[0].content,'new');
  const cleared=actions.clearArchivedDrafts([original,draft('b','keep')],[original]);assert.equal(cleared.drafts[0].content,'');assert.equal(cleared.drafts[1].content,'keep');assert.deepEqual(cleared.deselect,['a']);
});
test('history tap queues full text only, persists across restart, and reuses failed message ID',async t=>{
  const {store}=await setup(t);const body='  原文\n'.repeat(10000);const [out]=await store.prepare([draft('a',body)],target,true);await store.markUnconfirmed(out.id,'offline');
  const queued=await store.queueHistory(out.id);assert.equal(queued.content,body);assert.equal(queued.kind,'retry');assert.equal((await store.getRecord(out.id)).attempts,0);
  assert.equal((await store.queueHistory(out.id)).id,queued.id);assert.equal((await store.history()).length,1);
  await store.init();const recovered=(await store.drafts()).find(d=>d.id===queued.id);assert.equal(recovered.source_outbox_id,out.id);
  const [retry]=await store.prepare([recovered],target,true);assert.equal(retry.id,out.id);assert.equal((await store.history()).length,1);
});
test('late delivery while retry is queued does not silently create a second delivery',async t=>{
  const {store}=await setup(t);const [out]=await store.prepare([draft('a','text')],target,true);const queued=await store.queueHistory(out.id);
  await store.applyResult(out.id,target,'delivered');const [retry]=await store.prepare([queued],target,true);assert.equal(retry.id,out.id);
  const successful=await store.queueHistory(out.id);assert.equal(successful.kind,'history');const [again]=await store.prepare([successful],target,true);assert.notEqual(again.id,out.id);
});
test('failed history records cannot be pushed to an unintended computer',async t=>{
  const {store}=await setup(t);const [out]=await store.prepare([draft('a','original destination')],target,true);const queued=await store.queueHistory(out.id);
  await assert.rejects(store.prepare([queued],{...target,instanceId:'other'},true),/原来的电脑/);
  assert.equal((await store.drafts()).find(d=>d.id===queued.id).content,queued.content);
});
test('automatic clipboard capture keeps full text and preserves unarchived old clipboard text',async t=>{
  const {store}=await setup(t);const full='  手机剪贴板\n'.repeat(10000);const first=await store.captureClipboard(full);
  assert.equal(first.content,full);assert.equal((await store.captureClipboard(full)).id,first.id);
  const second=await store.captureClipboard('second');assert.equal((await store.drafts()).find(d=>d.id===first.id).content,full);
  await store.prepare([second],target,true);await store.captureClipboard('third');
  assert.equal((await store.drafts()).find(d=>d.id===second.id).content,'');assert.equal((await store.history())[0].content,'second');
});
test('home presentation stays themed and compact, and row clicks have distinct meanings',()=>{
  const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const controller=read('apps/mobile/src/plus/PlusHome.tsx'),view=read('apps/mobile/src/plus/HomeView.tsx'),settings=read('apps/mobile/src/screens/SettingsScreen.tsx');
  assert.match(controller,/useTheme\(\)/);assert.match(view,/testID="clipboard-preview" numberOfLines=\{3\}/);
  assert(!view.includes('新增草稿'));assert(!view.includes('重新发现'));assert(!view.includes('扫码连接'));assert(!controller.includes('CameraView'));
  assert.match(view,/onPress=\{\(\)=>p.queueHistory\(r.id\)\}/);assert.match(view,/onPress=\{\(\)=>p.copyRemote\(entry\)\}/);
  assert.match(settings,/<ConnectionSettings \/>/);assert.match(view,/>推送<\/Text>/);
});
