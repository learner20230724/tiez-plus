import type { Endpoint } from './transport';
export type SeenEndpoint = Endpoint & { seen: number };
export function chooseEndpoint(endpoints: SeenEndpoint[], preferred: string | null, now = Date.now()): Endpoint | null {
  const available = endpoints.filter(e => now - e.seen < 45000);
  const remembered = available.find(e => e.instanceId === preferred);
  // Never silently switch the destination of a pending message to a new computer.
  return remembered || (!preferred && available.length === 1 ? available[0] : null);
}
