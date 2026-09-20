'use strict';
// Explicit installation diagnostic: a temporary native mobile identity sends only
// an application-level ping. Never sends text or reads clipboard/history contents.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const mqtt=require('mqtt');
const P=require('../protocol/index.cjs');
async function main(){
  const endpoint=JSON.parse(fs.readFileSync(path.join(process.env.ProgramData,'TIEZ Plus/broker/endpoint.json'),'utf8'));
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
    const request={v:1,id:randomUUID(),requestId:randomUUID(),type:'ping',from:identity.deviceId,to:endpoint.desktopId};
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Desktop did not return an application response in 10 seconds')),10000);
      client.on('message',(_topic,bytes)=>{
        try {const r=JSON.parse(bytes.toString());
          if(r.v!==1 || r.type!=='response' || r.from!==request.to || r.to!==request.from || r.id!==request.id || r.requestId!==request.requestId)return;
          clearTimeout(timer);r.ok===true?resolve():reject(new Error('Desktop responded but is not ready'));
        } catch(error){clearTimeout(timer);reject(error);}
      });
      client.publish(P.requestTopic(endpoint.instanceId,endpoint.desktopId),JSON.stringify(request),{qos:1,retain:false},error=>{if(error){clearTimeout(timer);reject(error);}});
    });
    console.log('PASS: desktop application replied to MQTT ping; this is not merely broker PUBACK. No clipboard or history request sent.');
  } finally {client.end(true);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
