const { createBroker } = require('./server.cjs');
createBroker({ dataDir: process.env.TIEZ_PLUS_BROKER_DATA, discovery: process.env.TIEZ_PLUS_TEST !== '1' }).then(service => {
  console.log(`TIEZ Plus broker ready; HTTP port ${service.info().httpPort}`);
  const close = () => service.close().then(() => process.exit(0));
  // On macOS the broker is an app-owned child, never a machine-wide service.
  const parentPid = Number(process.env.TIEZ_PLUS_PARENT_PID);
  if (process.platform === 'darwin' && Number.isSafeInteger(parentPid) && parentPid > 1) {
    setInterval(() => {
      try { process.kill(parentPid, 0); } catch (error) { if (error.code === 'ESRCH') close(); }
    }, 2000).unref();
  }
  process.on('SIGINT', close); process.on('SIGTERM', close);
}).catch(error => { console.error('Broker startup failed:', error.code || error.message); process.exitCode = 1; });
