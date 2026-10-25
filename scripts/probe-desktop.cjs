'use strict';
// Explicit installation diagnostic: a temporary native mobile identity sends only
// an application-level ping. Never sends text or reads clipboard/history contents.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const mqtt=require('mqtt');
const P=require('../protocol/index.cjs');
async function main(){
  const samples=Number(process.argv[2]||1);
  const interval=Number(process.argv[3]||10000);
  if(!Number.isInteger(samples)||samples<1||samples>120||!Number.isInteger(interval)||interval<0||interval>60000)throw new Error('Usage: node scripts/probe-desktop.cjs [samples 1..120] [intervalMs 0..60000]');
  const endpointFile = process.env.TIEZ_PLUS_ENDPOINT || (process.platform === 'darwin'
    ? path.join(require('node:os').homedir(), 'Library/Application Support/io.github.learner20230724.tiezplus.desktop/broker/endpoint.json')
    : path.join(process.env.ProgramData, 'TIEZ Plus/broker/endpoint.json'));
  const endpoint=JSON.parse(fs.readFileSync(endpointFile,'utf8'));
  const response=await fetch(`http://127.0.0.1:${endpoint.httpPort}/api/v1/enroll`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role:'mobile',deviceId:randomUUID(),name:'Plus startup health probe'}),signal:AbortSignal.timeout(5000),
  });
  if(!response.ok)throw new Error(`Enrollment failed: ${response.status}`);
  const identity=await response.json();
  const client=mqtt.connect(`ws://127.0.0.1:${endpoint.httpPort}/mqtt`,{
    clientId:identity.deviceId,username:identity.deviceId,password:identity.token,
    clean:true,reconnectPeriod:0,connectTimeout:5000,queueQoSZero:false,
  });
  try {
    await new Promise((resolve,reject)=>{
      client.once('error',reject);
      client.once('connect',()=>client.subscribe(P.responseTopic(endpoint.instanceId,identity.deviceId),{qos:1},(error,granted)=>{
        if(error)reject(error);else if(!granted?.length || granted[0].qos===128)reject(new Error('Subscription rejected'));else resolve();
      }));
    });
    for(let sample=0;sample<samples;sample++) {
      if(sample)await new Promise(resolve=>setTimeout(resolve,interval));
      const request={v:1,id:randomUUID(),requestId:randomUUID(),type:'ping',from:identity.deviceId,to:endpoint.desktopId};
      const started=Date.now();
      await new Promise((resolve,reject)=>{
        const finish=error=>{clearTimeout(timer);client.removeListener('message',message);client.removeListener('close',closed);error?reject(error):resolve();};
        const message=(_topic,bytes)=>{
          try {const r=JSON.parse(bytes.toString());
            if(r.v!==1 || r.type!=='response' || r.from!==request.to || r.to!==request.from || r.id!==request.id || r.requestId!==request.requestId)return;
            finish(r.ok===true?undefined:new Error('Desktop responded but is not ready'));
          } catch(error){finish(error);}
        };
        const closed=()=>finish(new Error('Connection closed during desktop probe'));
        const timer=setTimeout(()=>finish(new Error('Desktop did not return an application response in 10 seconds')),10000);
        client.on('message',message);client.once('close',closed);
        client.publish(P.requestTopic(endpoint.instanceId,endpoint.desktopId),JSON.stringify(request),{qos:1,retain:false},error=>{if(error)finish(error);});
      });
      console.log(`Application ping ${sample+1}/${samples}: ${Date.now()-started} ms`);
    }
    console.log('PASS: desktop application replied to MQTT ping; this is not merely broker PUBACK. No clipboard or history request sent.');
  } finally {client.end(true);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
