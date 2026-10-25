// Exercise the production runtime with real MQTT brokers and real SQLite.
// Only Android OS bindings are replaced; no APK or emulator is required.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import mqtt from 'mqtt';
import {createBroker} from '../services/broker/server.cjs';
import P from '../protocol/index.cjs';
import actions from '../apps/mobile/src/plus/actions.ts';
const source=new URL('../apps/mobile/src/plus/runtime.ts',import.meta.url);
const compiled=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
async function runtimeHarness(t) {
  const db=new DatabaseSync(':memory:');
  const adapter={execAsync:async sql=>{db.exec(sql);},runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)??null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)};
  const secrets=new Map();const require=createRequire(source);
  const mocks={
    'react-native':{NativeModules:{PlusDiscovery:{start(){},stop(){}}},NativeEventEmitter:class{addListener(){return{remove(){}};}}},
    'expo-sqlite':{openDatabaseAsync:async()=>adapter},
    'expo-secure-store':{getItemAsync:async k=>secrets.get(k)||null,setItemAsync:async(k,v)=>{secrets.set(k,v);}},
    'expo-crypto':{randomUUID},
  };
  const m={exports:{}};
  vm.runInNewContext(compiled,{module:m,exports:m.exports,require:id=>mocks[id]||require(id),fetch,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,console});
  const r=m.exports;await r.startDiscovery();
  t.after(()=>{r.stopDiscovery();db.close();});
  return r;
}
async function computer(t,name) {
  const dir=await mkdtemp(path.resolve('.runtime/test-multi-'));
  const server=await createBroker({dataDir:dir,host:'127.0.0.1',tcpPort:0,webPort:0,discovery:false});
  const endpoint={...server.info(),host:'127.0.0.1',name};
  const res=await fetch(`http://127.0.0.1:${endpoint.httpPort}/api/v1/enroll`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'desktop',deviceId:randomUUID()})});
  const creds=await res.json();
  const client=mqtt.connect(`mqtt://127.0.0.1:${endpoint.mqttPort}`,{clientId:creds.deviceId,username:creds.deviceId,password:creds.token,reconnectPeriod:0});
  const state={endpoint,requests:[],fail:false,afterSend:null};
  await new Promise((resolve,reject)=>{client.once('error',reject);client.once('connect',()=>client.subscribe(P.requestTopic(endpoint.instanceId,endpoint.desktopId),{qos:1},e=>e?reject(e):resolve()));});
  client.on('message',(_topic,bytes)=>{
    const req=JSON.parse(bytes);state.requests.push(req);
    let result={ok:true};
    if(req.type==='send_text'){result={status:state.fail?'copy_failed':'delivered',error:state.fail?'busy':undefined};state.afterSend?.();}
    else if(req.type==='delivery_status')result={status:'not_found'};
    else if(req.type==='get_current'||req.type==='get_content')result={ok:true,content:`${name} clipboard`};
    else if(req.type==='get_history')result={ok:true,entries:[]};
    client.publish(P.responseTopic(endpoint.instanceId,req.from),JSON.stringify({...result,v:1,type:'response',id:req.id,requestId:req.requestId,from:endpoint.desktopId,to:req.from}),{qos:1});
  });
  t.after(async()=>{client.end(true);await server.close();await rm(dir,{recursive:true,force:true});});
  return state;
}
const draft=id=>({id,content:`  text-${id} 中文🙂\r\n`,revision:1,updated_at:1});
function discovered(r,...computers){for(const c of computers)r.runtime.endpoints.set(c.endpoint.instanceId,{...c.endpoint,seen:Date.now()});}

test('runtime broadcasts to two brokers while pull follows only the settings selection',async t=>{
  const a=await computer(t,'A'),b=await computer(t,'B'),r=await runtimeHarness(t);discovered(r,a,b);
  await r.connect(a.endpoint);assert(r.runtime.ready);const selected=r.runtime.connection;
  const sent=await r.sendDrafts([draft('one'),draft('two')]);
  assert.equal(sent.delivered,4);assert.equal(sent.computers,2);assert.equal(r.runtime.connection,selected);
  for(const c of [a,b])assert.deepEqual(c.requests.filter(x=>x.type==='send_text').map(x=>x.content),[draft('one').content,draft('two').content]);
  assert.equal((await actions.readComputer(r.runtime.connection)).current.content,'A clipboard');
  assert.equal(b.requests.filter(x=>x.type.startsWith('get_')).length,0);
  await r.connect(b.endpoint);assert(selected.connected); // Selecting B must not close A.
  assert.equal((await actions.readComputer(r.runtime.connection)).current.content,'B clipboard');
  assert.equal((await r.runtime.store.history()).filter(x=>x.status==='delivered').length,4);
});
test('partial delivery is not success; retry only sends the failed original recipient with the same ID',async t=>{
  const a=await computer(t,'A'),b=await computer(t,'B'),r=await runtimeHarness(t);discovered(r,a,b);b.fail=true;
  await r.connect(a.endpoint);
  await assert.rejects(r.sendDrafts([draft('partial')]),/1\/2/);
  const rows=await r.runtime.store.history();const failed=rows.find(x=>x.target_instance===b.endpoint.instanceId);
  assert.equal(failed.status,'copy_failed');assert.equal(rows.find(x=>x.target_instance===a.endpoint.instanceId).status,'delivered');
  b.fail=false;const retry=await r.runtime.store.queueHistory(failed.id);
  const sent=await r.sendDrafts([retry]);assert.equal(sent.computers,1);
  assert.equal(a.requests.filter(x=>x.type==='send_text').length,1);
  const attempts=b.requests.filter(x=>x.type==='send_text');assert.equal(attempts.length,2);assert(attempts.every(x=>x.id===failed.id));
  // A late ACK after retry is queued must prevent even an explicit stale retry from resending.
  await r.sendDrafts([retry]);assert.equal(b.requests.filter(x=>x.type==='send_text').length,2);
});
test('broadcast works before selecting a pull computer; stopping discovery closes all connections',async t=>{
  const a=await computer(t,'A'),b=await computer(t,'B'),r=await runtimeHarness(t);discovered(r,a,b);
  assert.equal(r.runtime.selected,null);await r.sendDrafts([draft('all')]);assert.equal(r.runtime.connection,null);
  r.stopDiscovery();assert.equal(r.runtime.ready,false);
  await assert.rejects(r.sendDrafts([draft('background')]),/前台|停止/);
  for(const c of [a,b])assert.equal(c.requests.filter(x=>x.type==='send_text').length,1);
});

test('a background/foreground transition cannot resume the remaining records of an old push',async t=>{
  const a=await computer(t,'A'),b=await computer(t,'B'),r=await runtimeHarness(t);discovered(r,a,b);
  let restart;
  await assert.rejects(r.sendDrafts([draft('cancel-one'),draft('cancel-two')],()=>{
    r.stopDiscovery();restart=r.startDiscovery();
  }),/0\/4/);
  await restart;
  assert.equal(a.requests.filter(x=>x.type==='send_text').length,0);
  assert.equal(b.requests.filter(x=>x.type==='send_text').length,0);
  const rows=await r.runtime.store.history();assert.equal(rows.length,4);assert(rows.every(x=>x.status==='unconfirmed'));
});
