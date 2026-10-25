import { NativeModules, NativeEventEmitter } from 'react-native';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { PlusStore, type Outbox, type Draft } from './store';
import { PlusConnection, checkDesktop, type Endpoint, type Credentials } from './transport';
import * as P from '../../../../protocol/index.cjs';
import { chooseEndpoint } from './discovery';
import { PeerPool, broadcastTargets, deliverBroadcast } from './fanout';

export const uuid = () => Crypto.randomUUID();
const listeners = new Set<() => void>();
export const runtime = {
  store: null as PlusStore | null, connection: null as PlusConnection | null,
  endpoints: new Map<string, Endpoint & { seen: number }>(), selected: null as Endpoint | null,
  selectionVersion: 0, ready: false, status: '正在查找同一局域网中的电脑…', error: '', connecting: false,
};
const notify = () => listeners.forEach(fn => fn());
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
let initialized: Promise<void> | null = null;
let active = false;
let connectionGeneration = 0;
let discoveryGeneration = 0;
let preferred: string | null = null;
let chooseTimer: ReturnType<typeof setTimeout> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const checking = new Set<string>();
export async function init() {
  if (!initialized) initialized = (async () => {
    const db = await SQLite.openDatabaseAsync('tiez-plus.sqlite');
    runtime.store = new PlusStore(db, uuid); await runtime.store.init();
    preferred = await runtime.store.readCache<string>('preferred-instance');
    runtime.selected = await runtime.store.readCache<Endpoint>('last-endpoint');
  })().catch(error => { initialized = null; throw error; });
  return initialized;
}
async function fetchJson(url: string, options: RequestInit = {}) {
  const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 4000);
  try { const response = await fetch(url, { ...options, signal: abort.signal }); if (!response.ok) throw new Error(`连接服务失败 (${response.status})`); return await response.json(); }
  finally { clearTimeout(timeout); }
}
export function isLanHost(host: string) { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)\d/.test(host) && /^\d+\.\d+\.\d+\.\d+$/.test(host) && host.split('.').every(x => Number(x) <= 255); }
export async function inspectEndpoint(host: string, port: number) {
  if (!isLanHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('不是有效的局域网 Plus 地址');
  const key = `${host}:${port}`; if (checking.has(key)) return; checking.add(key);
  try {
    const i = await fetchJson(`http://${host}:${port}/api/v1/info`);
    if (i.product !== 'tiez-plus' || i.v !== 1 || !P.validId(i.instanceId) || !P.validId(i.desktopId) || i.wsPath !== '/mqtt') throw new Error('不兼容的 Plus 协议');
    const endpoint: Endpoint & { seen: number } = { ...i, name: String(i.name || 'TIEZ Plus').slice(0,80), host, httpPort: port, seen: Date.now() };
    runtime.endpoints.set(i.instanceId, endpoint); notify();
    clearTimeout(chooseTimer);
    chooseTimer = setTimeout(() => {
      if (!active || runtime.connection?.connected || runtime.connecting) return;
      const list = [...runtime.endpoints.values()].filter(e => Date.now() - e.seen < 45000);
      const match = chooseEndpoint(list, preferred);
      if (match) void connect(match); else { runtime.status = preferred ? '上次连接的电脑不可用；可手动选择另一台电脑' : '发现多台电脑，请选择设备名'; notify(); }
    }, preferred ? 300 : 3000);
    return endpoint;
  } finally { checking.delete(key); }
}
// Connections used by push are independent of the computer selected for pull.
const peers = new PeerPool<PlusConnection>(async endpoint => {
  const storageKey = `plus_${endpoint.instanceId}`;
  const old = await SecureStore.getItemAsync(storageKey);
  const identity: Credentials = old ? JSON.parse(old) : { deviceId: uuid(), token: '' };
  const enrolled = await fetchJson(`http://${endpoint.host}:${endpoint.httpPort}/api/v1/enroll`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'mobile', name: 'TIEZ Plus Android', ...identity }),
  });
  await SecureStore.setItemAsync(storageKey, JSON.stringify({ deviceId: enrolled.deviceId, token: enrolled.token }));
  const c = new PlusConnection(endpoint, enrolled, uuid);
  c.onDisconnect = () => {
    if (runtime.connection === c) { runtime.ready = false; runtime.status = '连接已断开；不会自动补发'; }
    notify();
  };
  c.onResult = result => { void runtime.store!.applyResult(result.id, endpoint, result.status, result.error || null).then(notify).catch(error => { runtime.error = `送达状态保存失败：${error.message}`; notify(); }); };
  try { await c.connect(); return c; } catch (error) { c.close(); throw error; }
});
const recovered = new WeakSet<PlusConnection>();
async function getConnection(endpoint: Endpoint) {
  if (!active) throw new Error('应用不在前台，请重新推送');
  const c = await peers.acquire(endpoint);
  if (!active) throw new Error('连接已停止，请重新推送');
  // Query receipts only. Reconnecting must never replay text automatically.
  if (!recovered.has(c)) { recovered.add(c); void recoverPending(c).catch(() => {}); }
  return c;
}
export function pushTargets() {
  return broadcastTargets([...runtime.endpoints.values()], peers.values().filter(c => c.connected).map(c => c.endpoint));
}
export async function connect(endpoint: Endpoint) {
  const generation = ++connectionGeneration;
  ++runtime.selectionVersion;
  const current = () => active && generation === connectionGeneration;
  runtime.connecting = true; runtime.ready = false; runtime.error = ''; runtime.status = '正在连接选中的拉取电脑…';
  runtime.connection = null; runtime.selected = endpoint; notify();
  try {
    await init();
    if (!current()) return;
    // Persist the explicit selection even if that computer is temporarily offline.
    preferred = endpoint.instanceId;
    await runtime.store!.cache('preferred-instance', preferred); await runtime.store!.cache('last-endpoint', endpoint);
    if (!current()) return;
    const c = await getConnection(endpoint);
    if (!current()) return;
    runtime.connection = c;
    await probe(c);
  } catch (error) { if(current()) {runtime.error = error instanceof Error ? error.message : String(error); runtime.status = '选中的电脑连接失败；文字保留在手机';} }
  finally { if(generation === connectionGeneration) {runtime.connecting = false; notify();} }
}
async function recoverPending(c: PlusConnection) {
  for (const record of await runtime.store!.pending(c.endpoint)) {
    if (!active || peers.peek(c.endpoint) !== c || !c.connected) break;
    // Query only, never send_text. A failure lets discovery repair the connection.
    try {await c.request('delivery_status', {}, record.id);} catch {break;}
  }
}

async function probe(c: PlusConnection) {
  const ready = await checkDesktop(c);
  if (runtime.connection !== c || !active) return;
  runtime.ready = ready;
  runtime.status = ready ? `${c.endpoint.name} · 电脑已就绪` : '电脑未响应，正在重新发现连接；文字不会自动补发';
  notify();
}
let nativeSubscriptions: Array<{remove(): void}> = [];
export async function startDiscovery() {
  if (active) return;
  const generation = ++discoveryGeneration;
  await init(); if (generation !== discoveryGeneration || active) return; active = true;
  await runtime.store!.prune(); if (!active || generation !== discoveryGeneration) return;
  const native = NativeModules.PlusDiscovery;
  if (native) {
    const emitter = new NativeEventEmitter(native);
    nativeSubscriptions = [emitter.addListener('PlusDiscovered', e => { void inspectEndpoint(e.host, e.httpPort).catch(() => {}); }),
      emitter.addListener('PlusDiscoveryError', () => { runtime.error = '自动发现受限：检查同一 Wi-Fi、专用网络、防火墙或用二维码连接。'; notify(); })];
    native.start();
  } else { runtime.error = '此功能需要原生 Android 安装包，不支持 Expo Go'; notify(); }
  const last = await runtime.store!.readCache<Endpoint>('last-endpoint');
  if (!active || generation !== discoveryGeneration) return;
  if (last) void inspectEndpoint(last.host, last.httpPort).catch(() => {});
  timer = setInterval(() => {
    if (!active) return;
    // Refresh every known computer, including peers not selected for pull.
    const known = new Map(runtime.endpoints);
    if (runtime.selected && !known.has(runtime.selected.instanceId)) known.set(runtime.selected.instanceId, { ...runtime.selected, seen: 0 });
    for (const endpoint of known.values()) void inspectEndpoint(endpoint.host, endpoint.httpPort).catch(() => {});
    for (const c of peers.values()) if (c.connected) void probe(c);
    if (!pushTargets().length) native?.start();
  }, 15000);
}
export function stopDiscovery() {
  active = false; ++discoveryGeneration; ++connectionGeneration; runtime.connecting = false; clearInterval(timer); clearTimeout(chooseTimer); NativeModules.PlusDiscovery?.stop();
  nativeSubscriptions.forEach(s => s.remove()); nativeSubscriptions = [];
  peers.closeAll(); runtime.connection = null; runtime.ready = false; notify();
}
export async function sendRecord(record: Outbox, targets = pushTargets(), generation = discoveryGeneration) {
  // A late ACK may have arrived after this retry was queued.
  if ((await runtime.store!.getRecord(record.id))?.status === 'delivered') return;
  const target = targets.find(e => e.instanceId === record.target_instance && e.desktopId === record.target_device);
  try {
    if (!target) throw new Error('原定电脑未发现，请上线后手动重试');
    if (!active || generation !== discoveryGeneration) throw new Error('连接已停止，请手动重试');
    const c = await getConnection(target);
    if (!active || generation !== discoveryGeneration) throw new Error('连接已停止，请手动重试');
    if ((await runtime.store!.getRecord(record.id))?.status === 'delivered') return;
    await runtime.store!.markSending(record.id); notify();
    if (!active || generation !== discoveryGeneration) throw new Error('连接已停止，请手动重试');
    const result = await c.request('send_text', { content: record.content }, record.id);
    await runtime.store!.applyResult(record.id, c.endpoint, result.status, result.error || null); notify();
    if (result.status !== 'delivered') throw new Error(result.error || '电脑未确认完成，内容已保留');
  } catch (error) {
    const row = await runtime.store!.getRecord(record.id);
    if (row?.status === 'delivered') return;
    // Preserve concrete copy_failed/unknown responses rather than overwriting them.
    if (row?.status === 'sending' || row?.status === 'saved') await runtime.store!.markUnconfirmed(record.id, error instanceof Error ? error.message : String(error));
    notify(); throw error;
  }
}
export async function sendDrafts(drafts: Draft[], onArchived?: (rows: Outbox[]) => void) {
  const generation = discoveryGeneration;
  await init();
  const targets = pushTargets(); // Freeze recipients for this explicit button press.
  for (const d of drafts) await runtime.store!.saveDraft(d);
  if (!active || generation !== discoveryGeneration) throw new Error('连接已停止；草稿已保存，请回到前台后手动推送');
  const rows = await runtime.store!.prepareBroadcast(drafts, targets);
  onArchived?.(rows); notify();
  const result = await deliverBroadcast(rows, row => sendRecord(row, targets, generation));
  if (result.failures.length) {
    const first = result.failures[0];
    throw new Error(`已确认 ${result.delivered}/${result.total} 条送达（共 ${result.computers} 台电脑）；未确认的记录保留在历史中。${first.record.target_name || first.record.target_device}：${first.error}`);
  }
  return result;
}
