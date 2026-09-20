import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import moduleUnderTest from '../apps/mobile/src/plus/store.ts';
const { PlusStore } = moduleUnderTest;
const target = {instanceId:'server',desktopId:'desktop'};
function setup(clock = Date.now) {
  const db = new DatabaseSync(':memory:');
  const adapter = {execAsync:async sql=>{db.exec(sql);},runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)??null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)};
  return {db,adapter,store:new PlusStore(adapter,randomUUID,clock)};
}
test('long Unicode text is durable before send, with exact whitespace',async t=>{
  const {db,store}=setup();t.after(()=>db.close());await store.init();
  const text='  '+ '长文本🙂\r\n\t'.repeat(10000)+'  ';
  const draft={id:'a',content:text,revision:1,updated_at:1};
  const [row]=await store.prepare([draft],target);
  assert.equal((await store.history())[0].content,text);assert.equal(row.status,'saved');
  await store.markUnconfirmed(row.id,'offline');assert.equal((await store.drafts())[0].content,text);
});
test('ACK cannot erase edits in flight or unselected drafts',async t=>{
  const {db,store}=setup();t.after(()=>db.close());await store.init();
  const a={id:'a',content:'selected',revision:1,updated_at:1},b={id:'b',content:'unselected',revision:1,updated_at:1};
  await store.saveDraft(b);const [row]=await store.prepare([a],target);
  await store.saveDraft({...a,content:'new edits',revision:2});
  await store.applyResult(row.id,target,'delivered');
  assert.deepEqual(new Set((await store.drafts()).map(x=>x.content)),new Set(['new edits','unselected']));
  assert.equal((await store.history())[0].content,'selected');
});
test('only acknowledged unchanged draft clears; failed one stays; stale autosave cannot resurrect it',async t=>{
  const {db,store}=setup();t.after(()=>db.close());await store.init();
  const a={id:'a',content:'success',revision:1,updated_at:1}, b={id:'b',content:'failed',revision:1,updated_at:1};
  const [ra,rb]=await store.prepare([a,b],target);
  await store.applyResult(ra.id,target,'delivered');await store.applyResult(rb.id,target,'copy_failed','busy');await store.saveDraft(a);
  const rows=await store.drafts();assert.equal(rows.find(d=>d.id==='a').content,'');assert.equal(rows.find(d=>d.id==='b').content,'failed');
});
test('failed write rolls back outbox and prevents network eligibility',async t=>{
  const {db,adapter,store}=setup();t.after(()=>db.close());await store.init();
  const run=adapter.runAsync;adapter.runAsync=async(sql,...p)=>{if(sql.startsWith('INSERT INTO plus_outbox'))throw Error('disk full');return run(sql,...p);};
  await assert.rejects(()=>store.prepare([{id:'a',content:'keep me',revision:1,updated_at:1}],target));
  assert.equal((await store.history()).length,0);assert.equal(db.prepare('SELECT count(*) n FROM plus_drafts').get().n,0);
});
test('restart marks sending unknown, never replay; cleanup only delivered after 90 days',async t=>{
  let now=1_000;const {db,store}=setup(()=>now);t.after(()=>db.close());await store.init();
  const records=await store.prepare(['delivered','sending','unknown','copy_failed'].map((content,i)=>({id:`d${i}`,content,revision:1,updated_at:now})),target);
  await store.applyResult(records[0].id,target,'delivered');await store.markSending(records[1].id);await store.applyResult(records[2].id,target,'unknown');await store.applyResult(records[3].id,target,'copy_failed');
  now+=91*86400000;await store.init();const result=await store.history();
  assert.equal(result.length,3);assert(!result.some(r=>r.status==='sending'||r.status==='delivered'));
  assert.equal(result.find(r=>r.id===records[1].id).status,'unconfirmed');
  assert.equal((await store.pending(target)).length,3);
});
test('late ACK is monotonic and a different target cannot confirm a message',async t=>{
  const {db,store}=setup();t.after(()=>db.close());await store.init();const [r]=await store.prepare([{id:'a',content:'x',revision:1,updated_at:1}],target);
  await store.applyResult(r.id,{...target,desktopId:'other'},'delivered');assert.equal((await store.history())[0].status,'saved');
  await store.applyResult(r.id,target,'delivered');await store.markUnconfirmed(r.id,'late timeout');await store.applyResult(r.id,target,'unknown');assert.equal((await store.history())[0].status,'delivered');
});


test('history pages use summaries but search and detail read the complete original',async t=>{
  const {db,store}=setup();t.after(()=>db.close());await store.init();
  const content='前'.repeat(400)+'全文搜索命中'+'尾'.repeat(10000);
  const [record]=await store.prepare([{id:'a',content,revision:1,updated_at:1}],target);
  const rows=await store.listHistory('全文搜索命中');
  assert.equal(rows.length,1);assert.equal(rows[0].preview.length,300);assert.equal(rows[0].content,undefined);
  assert.equal((await store.getRecord(record.id)).content,content);
  assert.equal((await store.listHistory('',100)).length,0);
});
