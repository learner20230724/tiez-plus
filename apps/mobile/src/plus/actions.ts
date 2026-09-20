import type { Draft } from './store';
export interface Remote { request(type: string, fields?: Record<string, unknown>): Promise<any> }
export function clearArchivedDrafts(current: Draft[], sent: Draft[]): {drafts: Draft[]; deselect: string[]} {
  const snapshots = new Map(sent.map(d => [d.id, d])); const deselect: string[] = [];
  const drafts = current.map(d => {
    const before = snapshots.get(d.id);
    if (!before || before.revision !== d.revision || before.content !== d.content) return d;
    deselect.push(d.id);
    return d.kind === 'clipboard' ? d : {...d, content:'', revision:d.revision+1, source_outbox_id:null};
  });
  return {drafts, deselect};
}
export function editorRows(drafts: Draft[]): Draft[] {
  const inputs = drafts.filter(d => !d.kind || d.kind === 'input');
  return [...inputs.filter(d => d.content.length > 0), ...inputs.filter(d => !d.content.length).slice(-1)];
}
export function draftSnapshotMatches(saved: Draft[], current: Draft[]): boolean {
  return saved.length === current.length && saved.every(d => current.some(c => c.id === d.id && c.revision === d.revision && c.content === d.content));
}
export function mergeDrafts(persisted: Draft[], local: Draft[]): Draft[] {
  const remaining = new Map(local.map(d => [d.id, d]));
  const merged = persisted.map(d => {
    const edited = remaining.get(d.id); remaining.delete(d.id);
    // ACK clearing and an edit can both advance revision N to N+1. Never discard the editor in that race.
    return edited && edited.revision >= d.revision ? edited : d;
  });
  return [...merged, ...remaining.values()];
}
export async function readComputer(remote: Remote) {
  const current = await remote.request('get_current');
  const recent = await remote.request('get_history', { limit: 50 });
  if (!recent.ok) throw new Error(recent.error || '历史读取失败');
  return { current, entries: recent.entries || [], note: recent.note || '' };
}
export async function readEntry(remote: Remote, entryId: string): Promise<string> {
  const response = await remote.request('get_content', { entryId });
  if (!response.ok || typeof response.content !== 'string') throw new Error(response.error || '正文读取失败');
  return response.content;
}
export async function copyText(content: string, write: (text: string) => Promise<boolean>) {
  if (!await write(content)) throw new Error('手机剪贴板写入失败，正文仍保留');
}
