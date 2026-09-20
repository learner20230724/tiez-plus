import mqtt, { type MqttClient } from 'mqtt';
import * as P from '../../../../protocol/index.cjs';
export type Endpoint = { product: 'tiez-plus'; v: 1; instanceId: string; desktopId: string; name: string; host: string; httpPort: number; wsPath: string; mqttPort?: number };
export type Credentials = { deviceId: string; token: string };
type Pending = { id: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class PlusConnection {
  private client?: MqttClient;
  private pending = new Map<string, Pending>();
  connected = false;
  onDisconnect: () => void = () => {};
  onResult: (result: any) => void = () => {};
  constructor(readonly endpoint: Endpoint, readonly credentials: Credentials, private uuid: () => string, private timeout = P.ACK_TIMEOUT_MS) {}
  async connect() {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => { this.close(); finish(new Error('连接服务器超时')); }, this.timeout);
      const c = mqtt.connect(`ws://${this.endpoint.host}:${this.endpoint.httpPort}${this.endpoint.wsPath}`, {
        clientId: this.credentials.deviceId, username: this.credentials.deviceId, password: this.credentials.token,
        clean: true, reconnectPeriod: 0, resubscribe: false, queueQoSZero: false, connectTimeout: this.timeout, keepalive: 15,
      });
      this.client = c;
      c.on('connect', () => c.subscribe(P.responseTopic(this.endpoint.instanceId, this.credentials.deviceId), { qos: 1 }, (error, granted) => {
        if (error || !granted?.length || granted[0].qos === 128) { this.close(); finish(error || new Error('响应订阅失败')); return; }
        this.connected = true; finish();
      }));
      c.on('message', (_topic, bytes) => {
        try {
          const m = JSON.parse(bytes.toString());
          if (m.v !== 1 || m.type !== 'response' || m.from !== this.endpoint.desktopId || m.to !== this.credentials.deviceId) return;
          const p = this.pending.get(m.requestId);
          if (p && p.id === m.id) { clearTimeout(p.timer); this.pending.delete(m.requestId); p.resolve(m); }
          // Late confirmations can update history, but never cause a new transmission.
          if (m.status && m.id) this.onResult(m);
        } catch { /* malformed responses never count as success */ }
      });
      c.on('error', () => { finish(new Error('MQTT 连接失败')); this.close(); });
      c.on('close', () => { finish(new Error('连接已断开')); this.disconnectPending(); });
    });
  }
  private disconnectPending() {
    const wasConnected = this.connected; this.connected = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('连接断开，未确认送达')); }
    this.pending.clear(); if (wasConnected) this.onDisconnect();
  }
  close() { const c = this.client; this.client = undefined; this.disconnectPending(); c?.end(true); }
  request(type: string, extra: Record<string, unknown> = {}, id = this.uuid()): Promise<any> {
    if (!this.connected || !this.client?.connected) return Promise.reject(new Error('服务尚未连接；文字已保留，请连接后手动重试'));
    const requestId = this.uuid();
    const message = { ...extra, v: 1, id, requestId, type, from: this.credentials.deviceId, to: this.endpoint.desktopId };
    try { P.validateRequest(message); } catch (e) { return Promise.reject(e); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('电脑未在 10 秒内确认；内容已保留，请手动重试')); }, this.timeout);
      this.pending.set(requestId, { id, resolve, reject, timer });
      this.client!.publish(P.requestTopic(this.endpoint.instanceId, this.endpoint.desktopId), JSON.stringify(message), { qos: 1, retain: false }, error => {
        if (error) { const p = this.pending.get(requestId); if (p) { clearTimeout(timer); this.pending.delete(requestId); reject(new Error('消息发布失败，未确认送达')); } }
        // Broker PUBACK is deliberately NOT application success.
      });
    });
  }
}
