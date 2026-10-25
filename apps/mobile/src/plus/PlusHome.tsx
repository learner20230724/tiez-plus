import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Keyboard, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../theme/ThemeContext';
import { useHaptics } from '../context/HapticContext';
import { runtime, init, subscribe, sendDrafts, uuid } from './runtime';
import { targetKey } from './fanout';
import type { Draft, OutboxSummary } from './store';
import { mergeDrafts, draftSnapshotMatches, clearArchivedDrafts, readComputer, readEntry, copyText, isPullTarget } from './actions';
import HomeView, { type Detail, type PullCache, type RemoteEntry } from './HomeView';

export default function PlusHome() {
  const {colors}=useTheme(); const {triggerHaptic}=useHaptics();
  const insets=useSafeAreaInsets(); const navigation=useNavigation();
  const [mode,setMode]=useState<'push'|'pull'>('push');
  const [drafts,setDrafts]=useState<Draft[]>([]); const draftsRef=useRef<Draft[]>([]);
  const [selected,setSelected]=useState<string[]>([]); const [loading,setLoading]=useState(true);
  const [saveLabel,setSaveLabel]=useState(''); const [feedback,setFeedback]=useState('');
  const feedbackTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const saveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [keyboard,setKeyboard]=useState(false);
  const [pushing,setPushing]=useState(false); const pushingRef=useRef(false);
  const [refreshing,setRefreshing]=useState(false); const refreshingRef=useRef(false);
  const [,redraw]=useState(0);
  const [pull,setPull]=useState<PullCache|null>(null); const [pullError,setPullError]=useState('');
  const [historyOpen,setHistoryOpen]=useState(false); const [history,setHistory]=useState<OutboxSummary[]>([]);
  const [search,setSearch]=useState(''); const searchRef=useRef(''); const [historyPage,setHistoryPage]=useState(0); const pageRef=useRef(0);
  const [detail,setDetail]=useState<Detail|null>(null);
  const captureBusy=useRef(false);
  const showError=(error:unknown)=>Alert.alert('操作未完成',error instanceof Error?error.message:String(error));
  const toast=(message:string)=>{clearTimeout(feedbackTimer.current);setFeedback(message);feedbackTimer.current=setTimeout(()=>setFeedback(''),2200);};
  function withInput(next:Draft[]) {
    return next.some(d=>(!d.kind||d.kind==='input')&&!d.content.length)?next:[...next,{id:uuid(),content:'',revision:1,updated_at:Date.now(),kind:'input' as const}];
  }
  function update(next:Draft[]) { const rows=withInput(next);draftsRef.current=rows;setDrafts(rows); }
  async function loadHistory() {
    if(!runtime.store)return;
    const query=searchRef.current,page=pageRef.current;
    const rows=await runtime.store.listHistory(query,page*100);
    if(query===searchRef.current&&page===pageRef.current)setHistory(rows);
  }
  async function reload() {
    if(!runtime.store)return;
    const persisted=await runtime.store.drafts();
    const local=draftsRef.current,merged=mergeDrafts(persisted,local);
    const byId=new Map(merged.map(d=>[d.id,d]));
    // Database timestamps must not shuffle the editor while the user is typing.
    const order=[...local.map(d=>d.id),...merged.filter(d=>!local.some(l=>l.id===d.id)).map(d=>d.id)];
    update(order.map(id=>byId.get(id)!).filter(Boolean));
    await loadHistory();
  }
  async function flush() {
    clearTimeout(saveTimer.current);
    if(!runtime.store)throw new Error('本地保存尚未就绪，输入内容未清除');
    const snapshot=draftsRef.current.map(d=>({...d}));
    for(const d of snapshot)await runtime.store.saveDraft(d);
    if(draftSnapshotMatches(snapshot,draftsRef.current))setSaveLabel('已保存');
  }
  function edit(id:string,content:string) {
    update(draftsRef.current.map(d=>d.id===id?{...d,content,revision:d.revision+1,updated_at:Date.now(),kind:'input',source_outbox_id:null}:d));
    setSelected(ids=>content.length?[...new Set([...ids,id])]:ids.filter(x=>x!==id));
    setSaveLabel('保存中…');clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{void flush().catch(()=>setSaveLabel('保存失败，请勿退出'));},250);
  }
  async function captureClipboard() {
    if(captureBusy.current)return; captureBusy.current=true;
    try {
      await init();
      const content=await Clipboard.getStringAsync(); // Preserve the exact full text; preview truncation is visual only.
      const item=await runtime.store!.captureClipboard(content);
      await reload();
      setSelected(ids=>content.length?[...new Set([...ids,item.id])]:ids.filter(id=>id!==item.id));
    } finally {captureBusy.current=false;}
  }
  async function push() {
    if(pushingRef.current)return;
    const chosen=draftsRef.current.filter(d=>selected.includes(d.id)&&d.content.length>0).map(d=>({...d}));
    if(!chosen.length){toast('请选择内容');return;}
    pushingRef.current=true;setPushing(true);
    try {
      await flush();
      const sent=await sendDrafts(chosen,()=>{
        // The history transaction has committed. Never clear unsaved or newer edits.
        const archived=clearArchivedDrafts(draftsRef.current,chosen);
        update(archived.drafts);setSelected(ids=>ids.filter(id=>!archived.deselect.includes(id)));
        toast('已存入历史');
      });
      triggerHaptic('success');toast(`已送达 ${sent.computers} 台电脑`);
    } catch(error) {showError(error);}
    finally {pushingRef.current=false;setPushing(false);await reload().catch(()=>{});}
  }
  async function pullNow() {
    if(refreshingRef.current)return; refreshingRef.current=true;setRefreshing(true);setPullError('');
    const connection=runtime.connection, version=runtime.selectionVersion;
    const current=()=>runtime.connection===connection && runtime.selectionVersion===version;
    try {
      if(!connection?.connected || !isPullTarget(connection.endpoint,runtime.selected))throw new Error('请选择拉取电脑并连接，请到设置查看电脑连接');
      const result=await readComputer(connection,current);
      const cache:PullCache={instanceId:connection.endpoint.instanceId,desktopId:connection.endpoint.desktopId,name:connection.endpoint.name,at:Date.now(),...result};
      await runtime.store!.cache(`pull:${targetKey(connection.endpoint)}`,cache);
      if(current())setPull(cache);
    } catch(error) {if(current())setPullError((error instanceof Error?error.message:String(error))+'；保留这台电脑的上次记录');}
    finally {refreshingRef.current=false;setRefreshing(false);}
  }
  async function refresh() {
    if(mode==='pull'){await pullNow();return;}
    if(refreshingRef.current)return;refreshingRef.current=true;setRefreshing(true);
    try {await flush();await captureClipboard();}catch(error){showError(error);}
    finally {refreshingRef.current=false;setRefreshing(false);}
  }
  async function copy(content:string) {await copyText(content,Clipboard.setStringAsync);triggerHaptic('success');toast('已复制');}
  async function remoteContent(entry:RemoteEntry) {
    const connection=runtime.connection,version=runtime.selectionVersion;
    if(!connection?.connected || !isPullTarget(pull,runtime.selected) || !isPullTarget(pull,connection.endpoint))throw new Error('原电脑未连接，无法获取全文');
    return readEntry(connection,entry.id,()=>runtime.connection===connection && runtime.selectionVersion===version);
  }
  async function queueHistory(id:string) {
    const draft=await runtime.store!.queueHistory(id);
    await reload();setSelected(ids=>[...new Set([...ids,draft.id])]);setHistoryOpen(false);setDetail(null);setMode('push');toast('已加入待推送');
  }
  async function viewHistory(id:string) {
    const record=await runtime.store!.getRecord(id);
    if(!record)throw new Error('记录已删除');
    setHistoryOpen(false);setDetail({title:'历史全文',content:record.content,record});
  }
  async function editDetail() {
    if(!detail)return;
    const draft:Draft=detail.draft?{...detail.draft,kind:'input',source_outbox_id:null,revision:detail.draft.revision+1,updated_at:Date.now()}:{id:uuid(),kind:'input',content:detail.content,revision:1,updated_at:Date.now()};
    // Save before dismissing a full-text view. A modified retry creates a new message.
    await runtime.store!.saveDraft(draft);await reload();setSelected(ids=>[...new Set([...ids,draft.id])]);setDetail(null);setMode('push');
  }
  function deleteDetail() {
    const id=detail?.record?.id;if(!id)return;
    Alert.alert('删除记录？','删除后无法从历史恢复。',[{text:'取消',style:'cancel'},{text:'删除',style:'destructive',onPress:()=>{void runtime.store!.remove(id).then(()=>{setDetail(null);return loadHistory();}).catch(showError);}}]);
  }
  const run=(action:()=>Promise<unknown>)=>{void action().catch(showError);};
  useEffect(()=>{
    let alive=true;
    let cachedTarget='';
    const syncPullTarget=async()=>{
      const endpoint=runtime.selected,key=endpoint?targetKey(endpoint):'';
      redraw(v=>v+1);
      if(key===cachedTarget)return;
      cachedTarget=key;setPull(null);setPullError('');setDetail(d=>d?.remoteTarget?null:d);
      if(!endpoint)return;
      const cached=await runtime.store!.readCache<PullCache>(`pull:${key}`);
      if(alive && cachedTarget===key && isPullTarget(cached,runtime.selected))setPull(cached);
    };
    const boot=init().then(async()=>{
      await reload();
      // Restored drafts are visible but never silently selected on app launch.
      setSelected([]);
      await syncPullTarget();
    }).catch(error=>{setSaveLabel('保存未就绪，请勿退出');showError(error);}).finally(()=>{if(alive)setLoading(false);});
    const off=subscribe(()=>{if(alive){void syncPullTarget().catch(()=>{});void reload().catch(()=>{});}});
    const app=AppState.addEventListener('change',state=>{
      if(state!=='active')void flush().catch(()=>setSaveLabel('保存失败，请勿退出'));
    });
    const blur=navigation.addListener('blur',()=>{void flush().catch(showError);});
    const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow',()=>setKeyboard(true));
    const hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>setKeyboard(false));
    const handleLink=async({url}:{url:string})=>{
      if(!url.startsWith('tiezplus://'))return;
      await boot;
      if(url.includes('sync-pull')) {setMode('pull');await pullNow();}
      else if(url.includes('sync-push')||url.includes('sync-now')) {setMode('push');}
    };
    const links=Linking.addEventListener('url',event=>{void handleLink(event).catch(showError);});
    void Linking.getInitialURL().then(url=>url?handleLink({url}):undefined).catch(showError);
    return ()=>{alive=false;off();blur();app.remove();show.remove();hide.remove();links.remove();clearTimeout(feedbackTimer.current);void flush().catch(()=>{});};
  },[]);
  const visiblePull=isPullTarget(pull,runtime.selected)?pull:null;
  const visibleDetail=detail?.remoteTarget && (!runtime.selected || detail.remoteTarget!==targetKey(runtime.selected))?null:detail;
  return <HomeView colors={colors} top={insets.top} bottom={insets.bottom} keyboard={keyboard} loading={loading} mode={mode}
    setMode={next=>{run(flush);setMode(next);if(next==='pull')void pullNow();}}
    drafts={drafts} selected={selected} edit={edit} toggle={id=>setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])}
    selectAll={()=>{const ids=draftsRef.current.filter(d=>d.content.length>0).map(d=>d.id);setSelected(old=>ids.every(id=>old.includes(id))?[]:ids);}}
    push={()=>void push()} pushing={pushing} refreshing={refreshing} refresh={()=>void refresh()} saveLabel={saveLabel} feedback={feedback}
    pull={visiblePull} pullError={pullError} offline={!runtime.ready} copyCurrent={()=>{if(isPullTarget(pull,runtime.selected) && typeof pull?.current.content==='string')run(()=>copy(pull.current.content!));else toast(visiblePull?.current.error||'没有文字');}}
    copyRemote={entry=>run(async()=>copy(await remoteContent(entry)))} viewRemote={entry=>run(async()=>{const content=await remoteContent(entry);setDetail({title:'电脑记录全文',content,remoteTarget:targetKey(runtime.selected!)});})}
    historyOpen={historyOpen} openHistory={()=>{run(flush);run(loadHistory);setHistoryOpen(true);}} closeHistory={()=>setHistoryOpen(false)} history={history} search={search}
    searchHistory={query=>{setSearch(query);searchRef.current=query;pageRef.current=0;setHistoryPage(0);run(loadHistory);}} historyPage={historyPage}
    changeHistoryPage={delta=>{pageRef.current=Math.max(0,pageRef.current+delta);setHistoryPage(pageRef.current);run(loadHistory);}}
    queueHistory={id=>run(()=>queueHistory(id))} viewHistory={id=>run(()=>viewHistory(id))} detail={visibleDetail} showDetail={setDetail} closeDetail={()=>setDetail(null)}
    copyDetail={()=>{if(visibleDetail)run(async()=>{await copy(visibleDetail.content);setDetail(null);});}} editDetail={()=>run(editDetail)} deleteDetail={deleteDetail}/>;
}
