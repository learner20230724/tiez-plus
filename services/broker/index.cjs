const { createBroker } = require('./server.cjs');
createBroker({ dataDir: process.env.TIEZ_PLUS_BROKER_DATA, discovery: process.env.TIEZ_PLUS_TEST !== '1' }).then(service => {
  console.log(`TIEZ Plus broker ready; HTTP port ${service.info().httpPort}`);
  const close = () => service.close().then(() => process.exit(0));
  process.on('SIGINT', close); process.on('SIGTERM', close);
}).catch(error => { console.error('Broker startup failed:', error.code || error.message); process.exitCode = 1; });
