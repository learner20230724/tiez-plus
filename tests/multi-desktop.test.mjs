import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fanout from '../apps/mobile/src/plus/fanout.ts';
import persistence from '../apps/mobile/src/plus/store.ts';
import actions from '../apps/mobile/src/plus/actions.ts';
const {PeerPool,broadcastTargets,deliverBroadcast}=fanout;
const {PlusStore}=persistence;
const {isPullTarget,readComputer,readEntry}=actions;
const endpoint=id=>({instanceId:id,desktopId:`pc-${id}`,name:id,host:'192.168.1.2',httpPort:18083});
function database(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const adapter={execAsync:async sql=>{db.exec(sql);},runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)??null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)};
  return {db,adapter,store:new PlusStore(adapter,randomUUID)};
}
const draft=(id='d')=>({id,content:`  中文🙂\r\n ${id}  `,revision:1,updated_at:1});
test('broadcast targets include all fresh computers, deduplicate addresses and exclude stale disconnected peers',()=>{
  const a=endpoint('a'),b=endpoint('b'),c=endpoint('c');
  assert.deepEqual(broadcastTargets([{...a,host:'192.168.1.3',seen:99000},{...b,seen:99000},{...c,seen:1}],[a],100000).map(e=>[e.instanceId,e.host]),[['a','192.168.1.3'],['b','192.168.1.2']]);
  assert.equal(broadcastTargets([{...c,seen:1}],[c],100000).length,1);
});
test('every recipient is durable, exact text and new edits survive independent acknowledgements',async t=>{
  const {store}=database(t);await store.init();const d=draft();
  const rows=await store.prepareBroadcast([d],[endpoint('a'),endpoint('b'),endpoint('a')]);
  assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);
  assert((await store.history()).every(r=>r.content===d.content));
  assert.equal((await store.drafts())[0].content,'');
  await store.saveDraft({...d,content:'new edit',revision:3});
  await store.applyResult(rows[0].id,endpoint('b'),'delivered');
  assert.equal((await store.getRecord(rows[0].id)).status,'saved');
  await store.applyResult(rows[0].id,endpoint('a'),'delivered');
  await store.markUnconfirmed(rows[1].id,'offline');
  assert.deepEqual((await store.history()).map(r=>r.status).sort(),['delivered','unconfirmed']);
  assert.equal((await store.drafts())[0].content,'new edit');
  assert.deepEqual(new Set((await store.listHistory()).map(r=>r.target_name)),new Set(['a','b']));
});
test('second recipient write failure rolls back all records and preserves the saved draft',async t=>{
  const {adapter,store}=database(t);await store.init();const d=draft();await store.saveDraft(d);
  const run=adapter.runAsync;let inserts=0;
  adapter.runAsync=async(sql,...p)=>{if(sql.startsWith('INSERT INTO plus_outbox')&&++inserts===2)throw Error('disk full');return run(sql,...p);};
  await assert.rejects(store.prepareBroadcast([d],[endpoint('a'),endpoint('b')]),/disk full/);
  assert.equal((await store.history()).length,0);assert.equal((await store.drafts())[0].content,d.content);
});
test('retry keeps original recipient and message ID even when other computers are discovered',async t=>{
  const {store}=database(t);await store.init();
  const [a,b]=await store.prepareBroadcast([draft()],[endpoint('a'),endpoint('b')]);
  await store.applyResult(a.id,endpoint('a'),'delivered');await store.markUnconfirmed(b.id,'timeout');
  const retry=await store.queueHistory(b.id);
  const [again]=await store.prepareBroadcast([retry],[endpoint('a'),endpoint('c')]);
  assert.equal(again.id,b.id);assert.equal(again.target_instance,'b');assert.equal((await store.history()).length,2);
  // Already delivered history explicitly added again is a new broadcast.
  const fresh=await store.queueHistory(a.id);const resend=await store.prepareBroadcast([fresh],[endpoint('a'),endpoint('c')]);
  assert.equal(resend.length,2);assert(resend.every(r=>r.id!==a.id));
});
test('no discovered computers keeps the draft intact; explicit retry still retains its original target',async t=>{
  const {store}=database(t);await store.init();const d=draft();await store.saveDraft(d);
  await assert.rejects(store.prepareBroadcast([d],[]),/尚未发现/);
  assert.equal((await store.drafts())[0].content,d.content);
  const [row]=await store.prepareBroadcast([d],[endpoint('a')]);const retry=await store.queueHistory(row.id);
  assert.equal((await store.prepareBroadcast([retry],[]))[0].id,row.id);
});
test('fan-out isolates failures, preserves draft order per computer, limits simultaneous computers',async()=>{
  const records=Array.from({length:7},(_,i)=>[0,1,2].map(n=>({id:`${i}-${n}`,target_instance:`${i}`,target_device:`pc-${i}`}))).flat();
  let active=0,max=0;const sent=new Map();
  const result=await deliverBroadcast(records,async r=>{
    active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));
    const list=sent.get(r.target_instance)||[];list.push(r.id);sent.set(r.target_instance,list);active--;
    if(r.target_instance==='0')throw Error('offline');
  });
  assert(max<=4);assert.equal(result.delivered,18);assert.equal(result.failures.length,3);assert.equal(result.computers,7);
  for(const [id,rows]of sent)assert.deepEqual(rows,[`${id}-0`,`${id}-1`,`${id}-2`]);
});
test('pool reuses a computer connection without closing others; changed address replaces only that peer',async()=>{
  const opened=[];const pool=new PeerPool(async endpoint=>{const c={endpoint,connected:true,close(){this.connected=false;}};opened.push(c);return c;});
  const a=await pool.acquire(endpoint('a')),b=await pool.acquire(endpoint('b'));
  assert.equal(await pool.acquire(endpoint('a')),a);assert(a.connected&&b.connected);
  const next=await pool.acquire({...endpoint('a'),host:'192.168.1.3'});
  assert(!a.connected);assert(b.connected&&next.connected);assert.equal(opened.length,3);
  pool.closeAll();assert(!next.connected&&!b.connected);
});
test('pool deduplicates simultaneous enrollment and rejects late connection completion after stop',async()=>{
  let finish,opens=0;const pool=new PeerPool(endpoint=>{opens++;return new Promise(resolve=>{finish=()=>resolve({endpoint,connected:true,close(){this.connected=false;}});});});
  const first=pool.acquire(endpoint('a')),second=pool.acquire(endpoint('a'));assert.equal(first,second);assert.equal(opens,1);
  pool.closeAll();finish();await assert.rejects(first,/过期/);assert.equal(pool.values().length,0);
});
test('pull requests only selected computer and drops responses after selection changes',async()=>{
  let selected='a';const calls=[];
  const a={request:async type=>{calls.push(type);if(type==='get_current')selected='b';return {ok:true,content:'A'};}};
  await assert.rejects(readComputer(a,()=>selected==='a'),/已切换/);assert.deepEqual(calls,['get_current']);
  selected='a';calls.length=0;
  await assert.rejects(readEntry(a,'entry',()=>{if(calls.length)selected='b';return selected==='a';}),/已切换/);
  assert.deepEqual(calls,['get_content']);
  assert(isPullTarget(endpoint('a'),endpoint('a')));assert(!isPullTarget(endpoint('a'),endpoint('b')));
  assert(!isPullTarget({instanceId:'a'},endpoint('a')));assert(!isPullTarget({...endpoint('a'),desktopId:'reinstalled'},endpoint('a')));
});
