import { NativeModules, NativeEventEmitter } from 'react-native';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { PlusStore, type Outbox, type Draft } from './store';
import { PlusConnection, type Endpoint, type Credentials } from './transport';
import * as P from '../../../../protocol/index.cjs';
import { chooseEndpoint } from './discovery';

export const uuid = () => Crypto.randomUUID();
const listeners = new Set<() => void>();
export const runtime = {
  store: null as PlusStore | null, connection: null as PlusConnection | null,
  endpoints: new Map<string, Endpoint & { seen: number }>(), selected: null as Endpoint | null,
  ready: false, status: '正在查找同一局域网中的电脑…', error: '', connecting: false,
};
const notify = () => listeners.forEach(fn => fn());
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
let initialized: Promise<void> | null = null;
let active = false;
let preferred: string | null = null;
let chooseTimer: ReturnType<typeof setTimeout> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const checking = new Set<string>();
export async function init() {
  if (!initialized) initialized = (async () => {
    const db = await SQLite.openDatabaseAsync('tiez-plus.sqlite');
    runtime.store = new PlusStore(db, uuid); await runtime.store.init();
    preferred = await runtime.store.readCache<string>('preferred-instance');
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
export async function connect(endpoint: Endpoint) {
  if (runtime.connecting) return;
  runtime.connecting = true; runtime.ready = false; runtime.error = ''; runtime.status = '服务可达，正在连接电脑…'; runtime.connection?.close(); runtime.selected = endpoint; notify();
  try {
    await init();
    const storageKey = `plus_${endpoint.instanceId}`;
    const old = await SecureStore.getItemAsync(storageKey);
    const identity: Credentials = old ? JSON.parse(old) : { deviceId: uuid(), token: '' };
    const enrolled = await fetchJson(`http://${endpoint.host}:${endpoint.httpPort}/api/v1/enroll`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'mobile', name: 'TIEZ Plus Android', ...identity }),
    });
    await SecureStore.setItemAsync(storageKey, JSON.stringify({ deviceId: enrolled.deviceId, token: enrolled.token }));
    const c = new PlusConnection(endpoint, enrolled, uuid);
    c.onDisconnect = () => { if (runtime.connection === c) { runtime.ready = false; runtime.status = '连接已断开；不会自动补发'; notify(); } };
    c.onResult = result => { void runtime.store!.applyResult(result.id, endpoint, result.status, result.error || null).then(notify).catch(error => { runtime.error = `送达状态保存失败：${error.message}`; notify(); }); };
    runtime.connection = c; await c.connect();
    if (!active) { c.close(); return; }
    preferred = endpoint.instanceId;
    await runtime.store!.cache('preferred-instance', preferred); await runtime.store!.cache('last-endpoint', endpoint);
    await probe(c);
    // Query only. Never replay pending texts on reconnect or app launch.
    if (runtime.ready) for (const record of await runtime.store!.pending(endpoint)) {
      if (!c.connected) break;
      await c.request('delivery_status', {}, record.id).catch(() => {});
    }
  } catch (error) { runtime.error = error instanceof Error ? error.message : String(error); runtime.status = '连接失败；文字保留在手机'; }
  finally { runtime.connecting = false; notify(); }
}
async function probe(c: PlusConnection) {
  try { const response = await c.request('ping'); if (runtime.connection !== c || !c.connected) return; runtime.ready = response.ok === true; runtime.status = runtime.ready ? `${c.endpoint.name} · 电脑已就绪` : '服务可达，电脑尚未就绪'; }
  catch { if (runtime.connection !== c) return; runtime.ready = false; runtime.status = '服务可达，但电脑程序未响应'; }
  notify();
}
let nativeSubscriptions: Array<{remove(): void}> = [];
export async function startDiscovery() {
  await init(); if (active) return; active = true; await runtime.store!.prune(); if (!active) return;
  const native = NativeModules.PlusDiscovery;
  if (native) {
    const emitter = new NativeEventEmitter(native);
    nativeSubscriptions = [emitter.addListener('PlusDiscovered', e => { void inspectEndpoint(e.host, e.httpPort).catch(() => {}); }),
      emitter.addListener('PlusDiscoveryError', () => { runtime.error = '自动发现受限：检查同一 Wi-Fi、专用网络、防火墙或用二维码连接。'; notify(); })];
    native.start();
  } else { runtime.error = '此功能需要原生 Android 安装包，不支持 Expo Go'; notify(); }
  const last = await runtime.store!.readCache<Endpoint>('last-endpoint');
  if (last) void inspectEndpoint(last.host, last.httpPort).catch(() => {});
  timer = setInterval(() => {
    if (!active || runtime.connecting) return;
    const c = runtime.connection;
    if (c?.connected) void probe(c);
    else {
      const lastKnown = runtime.selected;
      if (lastKnown) void inspectEndpoint(lastKnown.host, lastKnown.httpPort).catch(() => {});
      native?.start();
    }
  }, 15000);
}
export function stopDiscovery() {
  active = false; clearInterval(timer); clearTimeout(chooseTimer); NativeModules.PlusDiscovery?.stop();
  nativeSubscriptions.forEach(s => s.remove()); nativeSubscriptions = [];
  runtime.connection?.close(); runtime.ready = false;
}
export async function sendRecord(record: Outbox) {
  const c = runtime.connection;
  if (!c || !c.connected || c.endpoint.instanceId !== record.target_instance || c.endpoint.desktopId !== record.target_device) {
    await runtime.store!.markUnconfirmed(record.id, '原定电脑未连接，请连接后手动重试'); notify(); throw new Error('原定电脑未连接，内容已保留');
  }
  await runtime.store!.markSending(record.id); notify();
  try {
    const result = await c.request('send_text', { content: record.content }, record.id);
    await runtime.store!.applyResult(record.id, c.endpoint, result.status, result.error || null); notify();
    if (result.status !== 'delivered') throw new Error(result.error || '电脑未确认完成，内容已保留');
  } catch (error) {
    // Do not overwrite a concrete copy_failed/unknown result with a generic timeout.
    const row = await runtime.store!.getRecord(record.id);
    if (row?.status === 'sending') await runtime.store!.markUnconfirmed(record.id, error instanceof Error ? error.message : String(error));
    notify(); throw error;
  }
}
export async function sendDrafts(drafts: Draft[], onArchived?: (rows: Outbox[]) => void) {
  const target = runtime.selected || await runtime.store!.readCache<Endpoint>('last-endpoint');
  // Drafts are still saved even when no computer has ever been selected.
  for (const d of drafts) await runtime.store!.saveDraft(d);
  if (!target) throw new Error('文字已保存为草稿，尚未发现电脑');
  const rows = await runtime.store!.prepare(drafts, target, true);
  onArchived?.(rows); notify();
  const errors: string[] = [];
  for (const row of rows) try { await sendRecord(row); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  if (errors.length) throw new Error(`${errors.length} 条未确认完成，已保留在历史中。${errors[0]}`);
}
