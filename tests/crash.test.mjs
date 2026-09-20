import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import storeModule from '../apps/mobile/src/plus/store.ts';
test('abruptly terminated writer retains full drafts/outbox in WAL on disk',async t=>{
  const dir=await mkdtemp(path.resolve('.runtime/test-crash-'));
  const file=path.join(dir,'mobile.sqlite');
  const child=spawn(process.execPath,['--import','tsx','tests/fixtures/crash-writer.mjs',file],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null)child.kill();await rm(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('writer did not persist')),15000);
    child.once('error',e=>{clearTimeout(timeout);reject(e);});
    child.stdout.on('data',b=>{if(b.toString().includes('DURABLE')){clearTimeout(timeout);resolve();}});
  });
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const db=new DatabaseSync(file);
  try {
    const adapter={execAsync:async q=>db.exec(q),runAsync:async(q,...p)=>db.prepare(q).run(...p),getFirstAsync:async(q,...p)=>db.prepare(q).get(...p)??null,getAllAsync:async(q,...p)=>db.prepare(q).all(...p)};
    const store=new storeModule.PlusStore(adapter,()=> 'unused');await store.init();
    assert.equal((await store.drafts())[0].content,'进程退出也不能丢\n  🙂');
    const records=await store.history();assert.equal(records[0].content,'进程退出也不能丢\n  🙂');assert.equal(records[0].status,'unconfirmed');
  } finally {db.close();}
});
