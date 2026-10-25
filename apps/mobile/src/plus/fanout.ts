import type { Endpoint } from './transport';
import type { Outbox, Target } from './store';
import type { SeenEndpoint } from './discovery';

export const targetKey = (target: Target) => `${target.instanceId}/${target.desktopId}`;
export function broadcastTargets(seen: SeenEndpoint[], connected: Endpoint[], now = Date.now()): Endpoint[] {
  const targets = new Map<string, Endpoint>();
  for (const e of connected) targets.set(e.instanceId, e);
  // Fresh discovery replaces old addresses. A stale, disconnected computer is not a new recipient.
  for (const e of seen) if (now - e.seen < 45000) targets.set(e.instanceId, e);
  return [...targets.values()];
}
export interface Peer { endpoint: Endpoint; connected: boolean; close(): void }
const addressKey = (e: Endpoint) => `${targetKey(e)}@${e.host}:${e.httpPort}`;
export class PeerPool<C extends Peer> {
  private peers = new Map<string, C>();
  private opening = new Map<string, {key: string; promise: Promise<C>}>();
  private generation = 0;
  constructor(private open: (endpoint: Endpoint) => Promise<C>) {}
  peek(endpoint: Target): C | undefined {
    const c = this.peers.get(endpoint.instanceId);
    return c && targetKey(c.endpoint) === targetKey(endpoint) ? c : undefined;
  }
  values() { return [...this.peers.values()]; }
  acquire(endpoint: Endpoint): Promise<C> {
    const old = this.peers.get(endpoint.instanceId), key = addressKey(endpoint);
    if (old?.connected && addressKey(old.endpoint) === key) return Promise.resolve(old);
    const pending = this.opening.get(endpoint.instanceId);
    if (pending?.key === key) return pending.promise;
    old?.close(); this.peers.delete(endpoint.instanceId);
    const generation = this.generation;
    const entry = {key, promise: null as unknown as Promise<C>};
    entry.promise = this.open(endpoint).then(c => {
      if (generation !== this.generation || this.opening.get(endpoint.instanceId) !== entry) {
        c.close(); throw new Error('连接已过期，请重新推送');
      }
      this.peers.set(endpoint.instanceId, c); return c;
    }).finally(() => { if (this.opening.get(endpoint.instanceId) === entry) this.opening.delete(endpoint.instanceId); });
    this.opening.set(endpoint.instanceId, entry);
    return entry.promise;
  }
  closeAll() {
    ++this.generation; this.opening.clear();
    for (const c of this.peers.values()) c.close();
    this.peers.clear();
  }
}
export type DeliveryFailure = {record: Outbox; error: string};
// Keep draft order on each computer, while an unresponsive computer cannot block other computers.
export async function deliverBroadcast(records: Outbox[], send: (record: Outbox) => Promise<void>) {
  const groups = new Map<string, Outbox[]>();
  for (const r of records) {
    const key = `${r.target_instance}/${r.target_device}`;
    const group = groups.get(key) || []; group.push(r); groups.set(key, group);
  }
  const queue = [...groups.values()]; const failures: DeliveryFailure[] = []; let delivered = 0;
  await Promise.all(Array.from({length: Math.min(4, queue.length)}, async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      for (const record of group) {
        try { await send(record); delivered++; }
        catch (e) { failures.push({record, error: e instanceof Error ? e.message : String(e)}); }
      }
    }
  }));
  return {delivered, total: records.length, computers: groups.size, failures};
}
