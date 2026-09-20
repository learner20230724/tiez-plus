import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { runtime, init, subscribe, startDiscovery, stopDiscovery, connect, inspectEndpoint, sendDrafts, sendRecord, uuid } from './runtime';
import type { Draft, Outbox } from './store';
import type { Endpoint } from './transport';

type RemoteEntry = { id: string; preview: string; timestamp: number; content_type: string };
type PullCache = { instanceId: string; name: string; at: number; current: { content?: string; error?: string; ok: boolean }; entries: RemoteEntry[] };
const stateName: Record<string, string> = { saved: '已保存，待手动发送', sending: '等待电脑确认', unconfirmed: '未确认送达', delivered: '已送达', stored: '电脑已保存', copy_failed: '电脑已保存，剪贴板写入失败', unknown: '结果待确认', rejected: '未送达' };

export default function PlusHome() {
  const insets = useSafeAreaInsets();
  const [, tick] = useState(0);
  const [page, setPage] = useState<'send'|'pull'|'history'>('send');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const draftsRef = useRef<Draft[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState<Outbox[]>([]);
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pull, setPull] = useState<PullCache | null>(null);
  const [pullError, setPullError] = useState('');
  const [detail, setDetail] = useState<{title: string; content: string; record?: Outbox} | null>(null);
  const [qr, setQr] = useState(false);
  const qrGuard = useRef(false);
  const [permission, askPermission] = useCameraPermissions();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateDrafts = (next: Draft[]) => { draftsRef.current = next; setDrafts(next); };
  const showError = (e: unknown) => Alert.alert('内容已保留', e instanceof Error ? e.message : String(e));
  async function reload() {
    if (!runtime.store) return;
    const persisted = await runtime.store.drafts();
    const current = new Map(draftsRef.current.map(d => [d.id, d]));
    const merged = persisted.map(d => { const local = current.get(d.id); current.delete(d.id); return local && local.revision > d.revision ? local : d; });
    updateDrafts([...merged, ...current.values()]);
    setHistory(await runtime.store.history());
  }
  async function flush() {
    clearTimeout(saveTimer.current);
    if (!runtime.store) throw new Error('本地数据库尚未就绪，文字未发送');
    const snapshot = draftsRef.current.map(d => ({...d}));
    for (const d of snapshot) await runtime.store.saveDraft(d);
    if (snapshot.every(d => draftsRef.current.find(x => x.id === d.id)?.revision === d.revision)) setSaved('已保存到手机');
  }
  async function addDraft(content = '') {
    const d = { id: uuid(), content, revision: 1, updated_at: Date.now() };
    updateDrafts([...draftsRef.current, d]); setSelected(ids => [...ids, d.id]); setPage('send'); setSaved('保存中…');
    try { await runtime.store!.saveDraft(d); setSaved('已保存到手机'); } catch { setSaved('保存失败，勿退出应用'); }
  }
  function edit(id: string, content: string) {
    updateDrafts(draftsRef.current.map(d => d.id === id ? { ...d, content, revision: d.revision + 1, updated_at: Date.now() } : d));
    setSaved('保存中…'); clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush().catch(() => setSaved('保存失败，勿退出应用；发送已禁用直到保存成功')); }, 250);
  }
  async function perform(fn: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true);
    try { await flush(); await fn(); } catch (error) { showError(error); }
    finally { await reload().catch(() => {}); busyRef.current = false; setBusy(false); }
  }
  async function pullNow() {
    setPage('pull'); setPullError('');
    const c = runtime.connection;
    if (!c?.connected) throw new Error('电脑未连接；上次拉取结果仍保留');
    try {
      const current = await c.request('get_current');
      const recent = await c.request('get_history', { limit: 50 });
      if (!recent.ok) throw new Error(recent.error || '历史读取失败');
      const cache: PullCache = { instanceId: c.endpoint.instanceId, name: c.endpoint.name, at: Date.now(), current, entries: recent.entries || [] };
      await runtime.store!.cache('pull', cache); setPull(cache);
    } catch (e) { setPullError('本次拉取失败，下方为旧缓存'); throw e; }
  }
  async function showRemote(entry: RemoteEntry, copy = false) {
    const c = runtime.connection;
    if (!c?.connected || c.endpoint.instanceId !== pull?.instanceId) throw new Error('原电脑未连接，不能获取完整正文');
    const response = await c.request('get_content', { entryId: entry.id });
    if (!response.ok || typeof response.content !== 'string') throw new Error(response.error || '正文读取失败');
    if (copy) { await Clipboard.setStringAsync(response.content); Alert.alert('已复制', '完整正文已复制到手机剪贴板'); }
    else setDetail({ title: '电脑记录全文', content: response.content });
  }
  useEffect(() => {
    let alive = true;
    void init().then(async () => {
      await reload(); if (!draftsRef.current.length) await addDraft();
      const cache = await runtime.store!.readCache<PullCache>('pull'); if (alive) setPull(cache);
      await startDiscovery();
    }).catch(error => { setSaved('本地存储初始化失败，请勿退出或发送'); showError(error); });
    const off = subscribe(() => { if (alive) { tick(v => v + 1); void reload().catch(() => {}); } });
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') { void startDiscovery().catch(showError); void reload().catch(showError); }
      else { void flush().catch(() => {}); stopDiscovery(); }
    });
    const handleLink = async ({url}: {url: string}) => {
      if (!url.startsWith('tiezplus://')) return;
      await init();
      if (url.includes('sync-pull')) { await perform(pullNow); }
      else if (url.includes('sync-push') || url.includes('sync-now')) {
        const text = await Clipboard.getStringAsync();
        if (text.trim()) { await addDraft(text); Alert.alert('已保存为草稿', '检查内容后点“发送所选”；不会在后台自动发送。'); }
      }
    };
    const link = Linking.addEventListener('url', e => { void handleLink(e).catch(showError); });
    void Linking.getInitialURL().then(url => { if (url) return handleLink({url}); }).catch(showError);
    return () => { alive = false; off(); app.remove(); link.remove(); void flush().catch(() => {}); stopDiscovery(); };
  }, []);
  const Button = ({label, onPress, danger = false}: {label: string; onPress: () => void; danger?: boolean}) => <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={[s.button, danger && s.danger, busy && {opacity: .5}]}><Text style={s.buttonText}>{label}</Text></Pressable>;
  return <KeyboardAvoidingView style={[s.root, {paddingTop: insets.top}]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={{padding: 18, paddingBottom: 120}} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>TIEZ Plus</Text><Text style={s.subtitle}>先保存，再传递。每一段文字都有去处。</Text>
      <View style={s.card}>
        <Text style={s.strong}>{runtime.status}</Text><Text style={s.small}>服务：{runtime.connection?.connected ? '已连接' : '未连接'}　电脑：{runtime.ready ? '已就绪' : '未就绪'}</Text>
        {!!runtime.error && <Text style={s.warning}>{runtime.error}</Text>}
        <View style={s.row}><Button label="重新发现" onPress={() => { stopDiscovery(); void startDiscovery().catch(showError); }}/><Button label="扫码连接" onPress={() => { qrGuard.current = false; setQr(true); }}/></View>
        {[...runtime.endpoints.values()].filter(e => Date.now() - e.seen < 45000).map(e => <Pressable key={e.instanceId} onPress={() => { void connect(e); }}><Text style={s.device}>{runtime.selected?.instanceId === e.instanceId ? '● ' : '○ '}{e.name} · {e.host}</Text></Pressable>)}
        <Text style={s.small}>仅用于可信家庭局域网。断线后不自动补发。</Text>
      </View>
      <View style={s.row}>{(['send', 'pull', 'history'] as const).map((p, i) => <Pressable key={p} onPress={() => setPage(p)} style={[s.tab, page === p && s.activeTab]}><Text style={page === p ? s.activeText : s.strong}>{['发送', '拉取', '手机历史'][i]}</Text></Pressable>)}</View>
      {page === 'send' && <>
        <Text style={s.small}>{saved}</Text>
        {drafts.map((d, index) => <View style={s.card} key={d.id}>
          <Pressable onPress={() => setSelected(ids => ids.includes(d.id) ? ids.filter(id => id !== d.id) : [...ids, d.id])}><Text style={s.strong}>{selected.includes(d.id) ? '☑' : '☐'} 草稿 {index + 1}</Text></Pressable>
          <TextInput accessibilityLabel={`草稿 ${index + 1}`} multiline value={d.content} onChangeText={text => edit(d.id, text)} placeholder="在这里写下文字，自动保存到手机…" placeholderTextColor="#738091" style={s.editor}/>
          <Text style={s.small}>{d.content.length} 字符</Text>
        </View>)}
        <View style={s.row}><Button label="新增草稿" onPress={() => { void addDraft().catch(showError); }}/><Button label="读取手机剪贴板" onPress={() => { void Clipboard.getStringAsync().then(addDraft).catch(showError); }}/></View>
        <Button label={busy ? '处理中…' : '发送所选，等待电脑确认'} onPress={() => { void perform(async () => {
          const chosen = draftsRef.current.filter(d => selected.includes(d.id) && d.content.trim());
          if (!chosen.length) throw new Error('请先选择有内容的草稿');
          await sendDrafts(chosen); Alert.alert('已送达', '电脑已保存内容并完成剪贴板写入。');
        }); }}/>
      </>}
      {page === 'pull' && <>
        <Button label={busy ? '拉取中…' : '拉取电脑当前内容与最近 50 条'} onPress={() => { void perform(pullNow); }}/>
        <Text style={s.small}>只展示，不自动复制。点击“复制”才改变手机剪贴板。</Text>
        {!!pullError && <Text style={s.warning}>{pullError}</Text>}
        {pull && <><Text style={s.small}>{pull.name} · 缓存于 {new Date(pull.at).toLocaleString()}{!runtime.ready ? ' · 离线/未就绪' : ''}</Text>
          <View style={s.card}><Text style={s.strong}>电脑当前剪贴板（拉取时快照）</Text><Text selectable style={s.body}>{pull.current.content?.slice(0, 500) || pull.current.error || '没有文字'}</Text>
            {typeof pull.current.content === 'string' && <View style={s.row}><Button label="全文" onPress={() => setDetail({title: '电脑当前内容', content: pull.current.content!})}/><Button label="复制" onPress={() => { void perform(async () => { await Clipboard.setStringAsync(pull.current.content!); Alert.alert('已复制'); }); }}/></View>}
          </View>
          {pull.entries.map(e => <View style={s.card} key={e.id}><Text style={s.body}>{e.preview}</Text><Text style={s.small}>{new Date(e.timestamp).toLocaleString()}</Text><View style={s.row}><Button label="查看全文" onPress={() => { void perform(() => showRemote(e)); }}/><Button label="复制" onPress={() => { void perform(() => showRemote(e, true)); }}/></View></View>)}
        </>}
      </>}
      {page === 'history' && <>
        <Text style={s.small}>已送达保留 90 天；失败、待确认和草稿不自动删除。</Text>
        <TextInput style={s.search} placeholder="搜索手机历史正文" value={search} onChangeText={setSearch}/>
        {history.filter(r => r.content.includes(search)).map(r => <Pressable key={r.id} style={s.card} onPress={() => setDetail({title: '手机记录全文', content: r.content, record: r})}>
          <Text style={[s.strong, {color: r.status === 'delivered' ? '#15754e' : '#9a5b12'}]}>{stateName[r.status] || r.status}</Text><Text style={s.body}>{r.content.slice(0, 300)}</Text><Text style={s.small}>{new Date(r.created_at).toLocaleString()} · {r.attempts} 次尝试</Text>{!!r.error && <Text style={s.warning}>{r.error}</Text>}
        </Pressable>)}
      </>}
    </ScrollView>
    <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}><View style={[s.root, {paddingTop: insets.top + 14, padding: 18}]}>
      <Text style={s.title}>{detail?.title}</Text><ScrollView style={{flex: 1}}><Text selectable style={s.full}>{detail?.content}</Text></ScrollView>
      <View style={s.row}><Button label="关闭" onPress={() => setDetail(null)}/><Button label="复制全文" onPress={() => { void perform(async () => { await Clipboard.setStringAsync(detail!.content); Alert.alert('已复制'); }); }}/><Button label="编辑/再次发送" onPress={() => { const text = detail!.content; setDetail(null); void addDraft(text).catch(showError); }}/></View>
      {detail?.record && <View style={s.row}>{detail.record.status !== 'delivered' && <Button label="原样重试" onPress={() => { const r = detail.record!; void perform(async () => { await sendRecord(r); setDetail(null); Alert.alert('已送达'); }); }}/>}<Button label="删除记录" danger onPress={() => Alert.alert('删除记录？', '删除后无法从本机历史恢复。', [{text: '取消', style: 'cancel'}, {text: '删除', style: 'destructive', onPress: () => { const id = detail.record!.id; void perform(async () => { await runtime.store!.remove(id); setDetail(null); }); }}])}/></View>}
    </View></Modal>
    <Modal visible={qr} onRequestClose={() => setQr(false)}><View style={[s.root, {paddingTop: insets.top + 12, padding: 18}]}><Text style={s.title}>扫描电脑上的 Plus 连接码</Text>
      {!permission?.granted ? <Button label="允许相机" onPress={() => { void askPermission(); }}/> : <CameraView style={{flex: 1}} barcodeScannerSettings={{barcodeTypes: ['qr']}} onBarcodeScanned={({data}) => {
        if (qrGuard.current) return; qrGuard.current = true;
        void (async () => { const json = data.startsWith('tiezplus://connect?data=') ? decodeURIComponent(data.split('?data=')[1]) : data; const value = JSON.parse(json); if (value.product !== 'tiez-plus' || value.v !== 1) throw new Error('请扫描 TIEZ Plus 的连接码'); await inspectEndpoint(value.host, value.httpPort); setQr(false); })().catch(e => { showError(e); qrGuard.current = false; });
      }}/>}<Button label="取消" onPress={() => setQr(false)}/>
    </View></Modal>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#f1f5f8'}, title: {fontSize: 28, fontWeight: '700', color: '#172b42'}, subtitle: {fontSize: 13, color: '#617287', marginVertical: 8},
  card: {backgroundColor: '#fff', borderRadius: 14, padding: 14, marginVertical: 7, borderColor: '#dce5ec', borderWidth: 1}, strong: {fontSize: 14, fontWeight: '600', color: '#22394e'},
  small: {fontSize: 12, color: '#65768a', marginVertical: 5}, warning: {fontSize: 12, color: '#a45413', marginTop: 5}, row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6},
  button: {backgroundColor: '#235e84', borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12, marginVertical: 3}, buttonText: {color: '#fff', fontSize: 13, fontWeight: '600'}, danger: {backgroundColor: '#a33d40'},
  tab: {flex: 1, alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: '#e1e9ef'}, activeTab: {backgroundColor: '#235e84'}, activeText: {color: '#fff', fontWeight: '600'},
  editor: {minHeight: 140, maxHeight: 340, fontSize: 16, color: '#1c3044', textAlignVertical: 'top', marginTop: 10}, body: {color: '#243c52', fontSize: 15, lineHeight: 23, marginVertical: 8},
  full: {color: '#172b42', fontSize: 16, lineHeight: 25, paddingVertical: 16}, device: {padding: 9, color: '#235e84'}, search: {backgroundColor: '#fff', padding: 12, borderRadius: 10, marginVertical: 10},
});
