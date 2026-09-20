// Platform-independent persistence: production uses expo-sqlite; tests use real SQLite.
export interface Database {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: any[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: any[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: any[]): Promise<T[]>;
}
export type Draft = { id: string; content: string; revision: number; updated_at: number };
export type Target = { instanceId: string; desktopId: string };
export type Outbox = {
  id: string; content: string; draft_id: string | null; draft_revision: number;
  target_instance: string; target_device: string; status: string;
  created_at: number; delivered_at: number | null; error: string | null; attempts: number;
};
export type OutboxSummary = Omit<Outbox, 'content'> & {preview: string};
export class PlusStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private db: Database, private uuid: () => string, private clock = Date.now) {}
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn); this.chain = result.catch(() => {}); return result;
  }
  private async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.db.execAsync('BEGIN IMMEDIATE');
    try { const result = await fn(); await this.db.execAsync('COMMIT'); return result; }
    catch (error) { await this.db.execAsync('ROLLBACK').catch(() => {}); throw error; }
  }
  async init() {
    await this.db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS plus_drafts(id TEXT PRIMARY KEY, content TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plus_outbox(id TEXT PRIMARY KEY, content TEXT NOT NULL, draft_id TEXT, draft_revision INTEGER NOT NULL,
      target_instance TEXT NOT NULL, target_device TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER, error TEXT, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS plus_cache(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS plus_outbox_created ON plus_outbox(created_at DESC);`);
    await this.db.runAsync("UPDATE plus_outbox SET status='unconfirmed',error='应用退出，送达结果待确认' WHERE status='sending'");
    await this.prune();
  }
  private async writeDraft(d: Draft) {
    await this.db.runAsync(`INSERT INTO plus_drafts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at WHERE excluded.revision>=plus_drafts.revision`, d.id, d.content, d.revision, d.updated_at);
  }
  saveDraft(d: Draft) { return this.serialized(() => this.writeDraft(d)); }
  drafts() { return this.serialized(() => this.db.getAllAsync<Draft>('SELECT * FROM plus_drafts ORDER BY updated_at,id')); }
  prepare(drafts: Draft[], target: Target) {
    return this.serialized(() => this.transaction(async () => {
      const result: Outbox[] = [];
      for (const d of drafts) {
        await this.writeDraft(d);
        const record: Outbox = { id: this.uuid(), content: d.content, draft_id: d.id, draft_revision: d.revision,
          target_instance: target.instanceId, target_device: target.desktopId, status: 'saved', created_at: this.clock(), delivered_at: null, error: null, attempts: 0 };
        await this.db.runAsync('INSERT INTO plus_outbox(id,content,draft_id,draft_revision,target_instance,target_device,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
          record.id, record.content, record.draft_id, record.draft_revision, record.target_instance, record.target_device, record.status, record.created_at);
        result.push(record);
      }
      return result;
    }));
  }
  markSending(id: string) { return this.serialized(() => this.db.runAsync("UPDATE plus_outbox SET status='sending',attempts=attempts+1,error=NULL WHERE id=? AND status<>'delivered'", id)); }
  markUnconfirmed(id: string, error: string) { return this.serialized(() => this.db.runAsync("UPDATE plus_outbox SET status='unconfirmed',error=? WHERE id=? AND status<>'delivered'", error, id)); }
  applyResult(id: string, target: Target, status: string, error: string | null = null) {
    return this.serialized(() => this.transaction(async () => {
      const r = await this.db.getFirstAsync<Outbox>('SELECT * FROM plus_outbox WHERE id=? AND target_instance=? AND target_device=?', id, target.instanceId, target.desktopId);
      if (!r || r.status === 'delivered') return;
      if (!['delivered', 'stored', 'copy_failed', 'unknown', 'rejected', 'not_found'].includes(status)) return;
      if (status === 'not_found') { await this.db.runAsync("UPDATE plus_outbox SET status='unconfirmed',error='电脑没有此条送达记录，请手动重试' WHERE id=?", id); return; }
      await this.db.runAsync('UPDATE plus_outbox SET status=?,error=?,delivered_at=? WHERE id=?', status, error, status === 'delivered' ? this.clock() : null, id);
      if (status === 'delivered' && r.draft_id) {
        // Compare-and-swap: never clear edits made while a send was in flight.
        await this.db.runAsync("UPDATE plus_drafts SET content='',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND content=?", this.clock(), r.draft_id, r.draft_revision, r.content);
      }
    }));
  }
  history(query = '') { return this.serialized(() => this.db.getAllAsync<Outbox>('SELECT * FROM plus_outbox WHERE instr(content,?)>0 ORDER BY created_at DESC,id DESC', query)); }
  getRecord(id: string) { return this.serialized(() => this.db.getFirstAsync<Outbox>('SELECT * FROM plus_outbox WHERE id=?',id)); }
  listHistory(query = '', offset = 0) { return this.serialized(() => this.db.getAllAsync<OutboxSummary>(
    `SELECT id,substr(content,1,300) preview,draft_id,draft_revision,target_instance,target_device,status,created_at,delivered_at,error,attempts
    FROM plus_outbox WHERE instr(content,?)>0 ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?`,query,Math.max(0,Math.floor(offset)))); }
  pending(target: Target) { return this.serialized(() => this.db.getAllAsync<Pick<Outbox,'id'>>("SELECT id FROM plus_outbox WHERE target_instance=? AND target_device=? AND status<>'delivered' ORDER BY created_at DESC LIMIT 50", target.instanceId, target.desktopId)); }
  remove(id: string) { return this.serialized(() => this.db.runAsync('DELETE FROM plus_outbox WHERE id=?', id)); }
  prune() { return this.serialized(() => this.db.runAsync("DELETE FROM plus_outbox WHERE status='delivered' AND delivered_at IS NOT NULL AND delivered_at<?", this.clock() - 90 * 86400000)); }
  cache(key: string, value: unknown) { return this.serialized(() => this.db.runAsync('INSERT OR REPLACE INTO plus_cache VALUES(?,?)', key, JSON.stringify(value))); }
  readCache<T>(key: string) { return this.serialized(async () => { const row = await this.db.getFirstAsync<{value: string}>('SELECT value FROM plus_cache WHERE key=?', key); return row ? JSON.parse(row.value) as T : null; }); }
}
