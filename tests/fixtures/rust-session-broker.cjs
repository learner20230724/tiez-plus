// Private child-process broker for Rust transport tests; never uses installed data.
const {createBroker}=require('../../services/broker/server.cjs');
const {randomUUID}=require('node:crypto');
(async()=>{
  const server=await createBroker({dataDir:process.argv[2],host:'127.0.0.1',tcpPort:0,webPort:0,discovery:false});
  const endpoint=server.info();
  const enroll=async role=>(await fetch(`http://127.0.0.1:${endpoint.httpPort}/api/v1/enroll`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,deviceId:randomUUID()})
  })).json();
  // Private pipe, consumed in memory by the test; credentials never go to test logs.
  process.stdout.write(JSON.stringify({endpoint,desktop:await enroll('desktop'),mobile:await enroll('mobile')})+'\n');
})().catch(error=>{console.error(error.message);process.exit(1);});
