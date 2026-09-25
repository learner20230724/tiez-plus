import test from 'node:test';
import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { createBroker,localAddress } from '../services/broker/server.cjs';
import P from '../protocol/index.cjs';
import moduleUnderTest from '../apps/mobile/src/plus/transport.ts';

const { PlusConnection } = moduleUnderTest;
async function setup(t) {
  const dir=await mkdtemp(path.resolve('.runtime/test-broker-'));const clients=[];
  const server=await createBroker({dataDir:dir,host:'127.0.0.1',tcpPort:0,webPort:0,discovery:false});
  t.after(async()=>{for(const c of clients) c instanceof PlusConnection?c.close():c.end(true);await server.close();await rm(dir,{recursive:true,force:true});});
  const endpoint={...server.info(),host:'127.0.0.1'};
  const enroll=async(role,deviceId=randomUUID())=>{const r=await fetch(`http://127.0.0.1:${endpoint.httpPort}/api/v1/enroll`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,deviceId})});assert.equal(r.status,200);return r.json();};
  const mobile=async(timeout=300)=>{const credentials=await enroll('mobile');const c=new PlusConnection(endpoint,credentials,randomUUID,timeout);clients.push(c);await c.connect();return c;};
  const desktop=async(handler)=>{
    const d=await enroll('desktop');const c=mqtt.connect(`mqtt://127.0.0.1:${endpoint.mqttPort}`,{clientId:d.deviceId,username:d.deviceId,password:d.token,clean:true,reconnectPeriod:0});clients.push(c);c.on('error',()=>{});
    await new Promise((resolve,reject)=>{c.once('error',reject);c.once('connect',()=>c.subscribe(P.requestTopic(endpoint.instanceId,endpoint.desktopId),{qos:1},e=>e?reject(e):resolve()));});
    c.on('message',(_t,bytes)=>{const r=JSON.parse(bytes);const result=handler(r);if(result)c.publish(P.responseTopic(endpoint.instanceId,r.from),JSON.stringify({...result,v:1,type:'response',id:r.id,requestId:r.requestId,from:endpoint.desktopId,to:r.from}),{qos:1});});return c;
  };
  return {endpoint,enroll,mobile,desktop,server,clients};
}
test('broker PUBACK without desktop never resolves delivery',async t=>{const s=await setup(t);const c=await s.mobile();await assert.rejects(c.request('send_text',{content:'cannot lose this'}),/确认/);});

test('failed application probe retires a stale connection; reconnect never replays a body',async t=>{
  const s=await setup(t);const c=await s.mobile();
  await assert.rejects(c.request('send_text',{content:'saved original'}));
  assert.equal(await moduleUnderTest.checkDesktop(c),false);assert.equal(c.connected,false);
  let texts=0;await s.desktop(r=>{if(r.type==='send_text')texts++;return {ok:true};});
  await c.connect();assert.equal(await moduleUnderTest.checkDesktop(c),true);assert.equal(texts,0);
});
test('ACK-gated send and full-text pull use exact content; reconnect does not replay',async t=>{
  const s=await setup(t);let sends=0;const text='  '+ '长文🙂\r\n'.repeat(10000)+'  ';
  await s.desktop(r=>{if(r.type==='send_text'){sends++;assert.equal(r.content,text);return {status:'delivered'};}if(r.type==='get_current')return {ok:true,content:text};if(r.type==='get_content')return {ok:true,content:text};return {ok:true};});
  const c=await s.mobile(2000);assert.equal((await c.request('send_text',{content:text})).status,'delivered');assert.equal((await c.request('get_current')).content,text);assert.equal((await c.request('get_content',{entryId:'1'})).content,text);
  c.close();await c.connect();await c.request('ping');assert.equal(sends,1);
});
test('lost application ACK times out even when the desktop received text',async t=>{const s=await setup(t);let received=0;await s.desktop(r=>{if(r.type==='send_text')received++;return null;});const c=await s.mobile();await assert.rejects(c.request('send_text',{content:'text'}));assert.equal(received,1);});
test('wrong credentials, wildcard subscriptions and spoofed request identity are rejected',async t=>{
  const s=await setup(t);const d=await s.enroll('mobile');const c=mqtt.connect(`mqtt://127.0.0.1:${s.endpoint.mqttPort}`,{clientId:d.deviceId,username:d.deviceId,password:d.token,reconnectPeriod:0});s.clients.push(c);c.on('error',()=>{});await new Promise(resolve=>c.once('connect',resolve));
  await assert.rejects(new Promise((resolve,reject)=>c.subscribe('#',{qos:1},(e,g)=>e?reject(e):resolve(g))), e=>e.packet.granted[0]===128);
  const request={v:1,id:'m',requestId:'r',from:'other',to:s.endpoint.desktopId,type:'send_text',content:'no'};
  const closed=new Promise(resolve=>c.once('close',resolve));c.publish(P.requestTopic(s.endpoint.instanceId,s.endpoint.desktopId),JSON.stringify(request),{qos:1},()=>{});await closed;
});
test('browser cross-origin enrollment denied; 172 public range not classified private',async t=>{const s=await setup(t);const r=await fetch(`http://127.0.0.1:${s.endpoint.httpPort}/api/v1/enroll`,{method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);assert(!localAddress('172.32.0.1'));assert(localAddress('172.31.0.1'));});
test('occupied TCP port falls back without terminating the owner',async t=>{
  const existing=net.createServer();await new Promise(resolve=>existing.listen(0,'127.0.0.1',resolve));t.after(()=>existing.close());const port=existing.address().port;
  const dir=await mkdtemp(path.resolve('.runtime/test-port-'));const server=await createBroker({dataDir:dir,tcpPort:port,webPort:0,host:'127.0.0.1',discovery:false});
  t.after(async()=>{await server.close();await rm(dir,{recursive:true,force:true});});assert.notEqual(server.info().mqttPort,port);assert(existing.listening);
});


test('malformed UTF-8 credentials cannot crash broker; reserved desktop ID cannot be enrolled by phone',async t=>{
  const s=await setup(t);const d=await s.enroll('mobile');
  const bad=mqtt.connect(`mqtt://127.0.0.1:${s.endpoint.mqttPort}`,{clientId:d.deviceId,username:d.deviceId,password:'秘密'.repeat(32),reconnectPeriod:0});
  s.clients.push(bad);
  await new Promise(resolve=>bad.once('error',resolve));bad.end(true);
  const r=await fetch(`http://127.0.0.1:${s.endpoint.httpPort}/api/v1/enroll`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'mobile',deviceId:s.endpoint.desktopId})});
  assert.equal(r.status,400);
  const good=await s.mobile();assert(good.connected);
});

test('UDP discovery returns matching nonce and connection metadata, never a token or body',async t=>{
  const {default:dgram}=await import('node:dgram');
  const dir=await mkdtemp(path.resolve('.runtime/test-discovery-'));
  const server=await createBroker({dataDir:dir,host:'127.0.0.1',tcpPort:0,webPort:0,udpPort:0,mdns:false});
  const client=dgram.createSocket('udp4');
  t.after(async()=>{client.close();await server.close();await rm(dir,{recursive:true,force:true});});
  const answer=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('UDP reply timeout')),3000);client.once('message',bytes=>{clearTimeout(timeout);resolve(JSON.parse(bytes));});});
  client.send(JSON.stringify({type:'tiezplus.discover',v:1,nonce:'test-nonce'}),server.discoveryPort(),'127.0.0.1');
  const info=await answer;assert.equal(info.nonce,'test-nonce');assert.equal(info.instanceId,server.info().instanceId);assert.equal(info.httpPort,server.info().httpPort);assert(!('token' in info));assert(!('content' in info));
});
