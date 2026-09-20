'use strict';
const Aedes = require('aedes');
const { WebSocketServer, createWebSocketStream } = require('ws');
const { Bonjour } = require('bonjour-service');
const net = require('node:net');
const http = require('node:http');
const dgram = require('node:dgram');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const P = require('../../protocol/index.cjs');

function localAddress(address = '') {
  const ip = address.replace(/^::ffff:/, '');
  return ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip.startsWith('169.254.');
}
function loopback(address = '') { return /^(::1|(::ffff:)?127\.)/.test(address); }
function addresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    /virtual|vmware|vbox|tailscale|zerotier|docker|vethernet|loopback/i.test(name) ? [] :
    (entries || []).filter(i => i.family === 'IPv4' && !i.internal && localAddress(i.address)).map(i => i.address));
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const fail = e => {
      server.removeListener('listening', ready);
      if (e.code === 'EADDRINUSE' && port !== 0) listen(server, 0, host).then(resolve, reject);
      else reject(e);
    };
    const ready = () => { server.removeListener('error', fail); resolve(server.address().port); };
    server.once('error', fail); server.once('listening', ready); server.listen(port, host);
  });
}
async function createBroker(options = {}) {
  const dataDir = options.dataDir || path.join(process.env.ProgramData || os.homedir(), 'TIEZ Plus', 'broker');
  const stateFile = path.join(dataDir, 'devices.json');
  // Corrupt state must not silently change identity or invalidate enrolled devices.
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { instanceId: randomUUID(), desktopId: randomUUID(), devices: {} };
  atomicJson(stateFile, state);
  const broker = Aedes({ id: state.instanceId, heartbeatInterval: 5000, connectTimeout: 5000 });
  let tcpPort = 0, webPort = 0, closed = false, bonjour, advertisement, udp, addressKey = '';
  const host = options.host || '0.0.0.0';
  const name = options.name || os.hostname();
  const info = () => ({ product: 'tiez-plus', v: 1, instanceId: state.instanceId, desktopId: state.desktopId, name, httpPort: webPort, mqttPort: tcpPort, wsPath: '/mqtt', addresses: addresses() });
  broker.authenticate = (client, username, password, cb) => {
    const device = state.devices[client.id];
    const supplied = password ? password.toString() : '';
    const expected = device?.token || '';
    const ok = username === client.id && /^[a-f0-9]{64}$/.test(supplied) && supplied.length === expected.length && !!expected && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (ok) client.plusRole = device.role;
    cb(null, ok);
  };
  const reqTopic = P.requestTopic(state.instanceId, state.desktopId);
  const presence = P.presenceTopic(state.instanceId, state.desktopId);
  broker.authorizeSubscribe = (client, sub, cb) => {
    const ok = client.plusRole === 'desktop' ? sub.topic === reqTopic :
      sub.topic === P.responseTopic(state.instanceId, client.id) || sub.topic === presence;
    cb(null, ok ? sub : null);
  };
  broker.authorizePublish = (client, packet, cb) => {
    try {
      if (packet.payload.length > P.MAX_PACKET_BYTES || packet.qos > 1) throw new Error('INVALID_PACKET');
      const m = JSON.parse(packet.payload.toString());
      if (client.plusRole === 'desktop') {
        if (packet.topic === presence) {
          if (m.v !== 1 || m.from !== state.desktopId || typeof m.ready !== 'boolean') throw new Error('INVALID_PRESENCE');
        } else {
          if (packet.retain || m.v !== 1 || m.from !== state.desktopId || !P.validId(m.to) || !P.validId(m.requestId) || state.devices[m.to]?.role !== 'mobile' || packet.topic !== P.responseTopic(state.instanceId, m.to)) throw new Error('INVALID_RESPONSE');
        }
      } else {
        if (packet.retain || packet.topic !== reqTopic) throw new Error('FORBIDDEN_TOPIC');
        P.validateRequest(m);
        if (m.from !== client.id || m.to !== state.desktopId) throw new Error('FORBIDDEN_DEVICE');
      }
      cb(null);
    } catch { cb(new Error('Invalid Plus protocol message')); }
  };
  // Content never enters logs. Clients use clean sessions; offline commands are not queued.
  broker.on('clientError', () => {});
  broker.on('connectionError', () => {});
  const tcp = net.createServer(socket => {
    if (!loopback(socket.remoteAddress)) return socket.destroy();
    broker.handle(socket);
  });
  const enrollRate = new Map();
  const web = http.createServer(async (req, res) => {
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (!localAddress(req.socket.remoteAddress)) return reply(403, { error: 'LAN_ONLY' });
    // Do not expose automatic enrollment to arbitrary browser pages.
    if (req.headers.origin) return reply(403, { error: 'NATIVE_CLIENT_REQUIRED' });
    if (req.method === 'GET' && req.url === '/api/v1/info') return reply(200, info());
    if (req.method !== 'POST' || req.url !== '/api/v1/enroll') return reply(404, { error: 'NOT_FOUND' });
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(415, { error: 'JSON_REQUIRED' });
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('BODY_TOO_LARGE'); }
      const input = JSON.parse(body);
      const role = input.role === 'desktop' ? 'desktop' : 'mobile';
      if (role === 'desktop' && !loopback(req.socket.remoteAddress)) return reply(403, { error: 'DESKTOP_LOCAL_ONLY' });
      const id = role === 'desktop' ? state.desktopId : input.deviceId;
      if (!P.validId(id)) return reply(400, { error: 'INVALID_ID' });
      const old = state.devices[id];
      if (old && (role === 'desktop' || input.token === old.token)) return reply(200, { ...info(), deviceId: id, token: old.token, role });
      if (old) return reply(409, { error: 'DEVICE_ALREADY_ENROLLED' });
      const ip = req.socket.remoteAddress;
      const rate = enrollRate.get(ip) || { count: 0, since: Date.now() };
      if (Date.now() - rate.since > 60000) { rate.count = 0; rate.since = Date.now(); }
      if (++rate.count > 10 || Object.keys(state.devices).length >= 256) return reply(429, { error: 'ENROLLMENT_LIMIT' });
      enrollRate.set(ip, rate);
      const token = randomBytes(32).toString('hex');
      state.devices[id] = { role, token, name: String(input.name || role).slice(0, 80) };
      try { atomicJson(stateFile, state); } catch (error) { delete state.devices[id]; throw error; }
      return reply(200, { ...info(), deviceId: id, token, role });
    } catch { return reply(400, { error: 'ENROLLMENT_FAILED' }); }
  });
  web.headersTimeout = 10000; web.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: P.MAX_PACKET_BYTES, perMessageDeflate: false });
  web.on('upgrade', (req, socket, head) => {
    if (req.url !== '/mqtt' || !localAddress(socket.remoteAddress) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => {
      const stream = createWebSocketStream(ws); stream.on('error', () => {}); broker.handle(stream);
    });
  });
  tcpPort = await listen(tcp, options.tcpPort ?? 18883, '127.0.0.1');
  webPort = await listen(web, options.webPort ?? 18083, host);
  atomicJson(path.join(dataDir, 'endpoint.json'), info());
  const advertise = () => {
    const key = addresses().join(',');
    if (key === addressKey && advertisement) return;
    addressKey = key; advertisement?.stop();
    if (bonjour && key) advertisement = bonjour.publish({ name: `TIEZ Plus ${name} ${state.instanceId.slice(0, 8)}`, type: 'tiezplus', port: webPort, txt: { v: '1', instanceId: state.instanceId, desktopId: state.desktopId } });
  };
  if (options.discovery !== false) {
    bonjour = new Bonjour(undefined, () => {}); advertise();
    udp = dgram.createSocket('udp4');
    udp.on('error', () => {}); // mDNS remains available if discovery port is occupied.
    udp.on('message', (bytes, remote) => {
      if (!localAddress(remote.address) || bytes.length > 512) return;
      try { const m = JSON.parse(bytes.toString()); if (m.type === 'tiezplus.discover' && m.v === 1 && P.validId(m.nonce)) udp.send(JSON.stringify({ ...info(), nonce: m.nonce }), remote.port, remote.address); } catch {}
    });
    udp.bind(options.udpPort ?? 18084, host);
  }
  const interval = setInterval(() => { advertise(); enrollRate.clear(); }, 30000); interval.unref();
  return { info, broker, async close() {
    if (closed) return; closed = true; clearInterval(interval);
    advertisement?.stop(); bonjour?.destroy();
    try { udp?.close(); } catch {}
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => broker.close(resolve));
    await Promise.all([tcp, web].map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections?.(); })));
    wss.close();
  } };
}
module.exports = { createBroker, localAddress, loopback };
