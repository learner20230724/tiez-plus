import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Text,View,Pressable} from 'react-native';
import HomeView from '../../apps/mobile/src/plus/HomeView';
import {Colors} from '../../apps/mobile/src/theme/colors';
import {clearArchivedDrafts} from '../../apps/mobile/src/plus/actions';
import {Feather} from './icons';
const parameters=new URLSearchParams(location.search);
const colors=parameters.get('theme')==='light'?Colors.light:Colors.dark;
const clipboard=parameters.get('short')?'复制的一小段文字':'这是一段从手机剪贴板读取的内容。文字很长也只显示最多三行，不会挤走下面的输入框。\n'.repeat(200);
const fullRemote='电脑上的完整记录，点击才复制，不用列表里的截断摘要。\n'.repeat(200);
const historyText='这段文字已经保存在手机历史，点击后会加入待推送列表，不会写入手机剪贴板。\n'.repeat(100);
(window as any).__qa={clipboard:'sentinel',writes:0,fullRemote,historyText,clipboardText:clipboard};
function App(){
 const [mode,setMode]=useState<'push'|'pull'>('push');const [historyOpen,setHistoryOpen]=useState(false);const [detail,setDetail]=useState(null);
 const [drafts,setDrafts]=useState([{id:'clip',kind:'clipboard',content:clipboard,revision:1,updated_at:1},{id:'input',kind:'input',content:'',revision:1,updated_at:1}]);
 const [selected,setSelected]=useState(['clip']);const [feedback,setFeedback]=useState('');const [search,setSearch]=useState('');
 const remote={instanceId:'test',name:'我的电脑',at:Date.now(),current:{ok:true,content:'电脑当前剪贴板内容'},entries:[{id:'remote',preview:fullRemote.slice(0,200),timestamp:Date.now(),content_type:'text'}]};
 const copy=(text:string)=>{(window as any).__qa.clipboard=text;(window as any).__qa.writes++;setFeedback('已复制');};
 const queue=()=>{setDrafts(old=>old.some(d=>d.id==='history')?old:[...old,{id:'history',kind:'retry',content:historyText,revision:1,updated_at:1}]);setSelected(old=>[...new Set([...old,'history'])]);setHistoryOpen(false);setMode('push');setFeedback('已加入待推送');};
 const edit=(id:string,text:string)=>{setDrafts(old=>{const next=old.map(d=>d.id===id?{...d,content:text,revision:d.revision+1}:d);return next.some(d=>d.kind==='input'&&!d.content)?next:[...next,{id:'next-'+Date.now(),kind:'input',content:'',revision:1,updated_at:1}];});setSelected(ids=>text?[...new Set([...ids,id])]:ids.filter(x=>x!==id));};
 return <View style={{flex:1,height:'100%',backgroundColor:colors.background}}><HomeView colors={colors} top={20} bottom={16} keyboard={false} loading={false} mode={mode} setMode={setMode} drafts={drafts as any} selected={selected} edit={edit} toggle={id=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])} selectAll={()=>setSelected(drafts.filter(d=>d.content).map(d=>d.id))} push={()=>{const r=clearArchivedDrafts(drafts as any,drafts.filter(d=>selected.includes(d.id)) as any);setDrafts(r.drafts as any);setSelected([]);setFeedback('已存入历史');}} pushing={false} refreshing={false} refresh={()=>{}} saveLabel="已保存" feedback={feedback} pull={remote} pullError="" offline={false} copyCurrent={()=>copy(remote.current.content)} copyRemote={()=>copy(fullRemote)} viewRemote={()=>setDetail({title:'电脑记录全文',content:fullRemote})} historyOpen={historyOpen} openHistory={()=>setHistoryOpen(true)} closeHistory={()=>setHistoryOpen(false)} history={[{id:'h1',preview:historyText.slice(0,300),status:'unconfirmed',created_at:Date.now(),attempts:1,error:'未确认送达'}] as any} search={search} searchHistory={setSearch} historyPage={0} changeHistoryPage={()=>{}} queueHistory={queue} viewHistory={()=>{setHistoryOpen(false);setDetail({title:'历史全文',content:historyText});}} detail={detail} showDetail={setDetail} closeDetail={()=>setDetail(null)} copyDetail={()=>copy(detail.content)} editDetail={queue} deleteDetail={()=>{}}/>
 <View style={{position:'absolute',left:0,right:0,bottom:0,height:85,paddingTop:12,paddingBottom:24,backgroundColor:colors.background,borderTopWidth:1,borderColor:colors.divider,flexDirection:'row'}}>{[['clipboard','同步'],['file','文件传输'],['settings','设置']].map(([icon,label])=><View key={icon} style={{flex:1,alignItems:'center',gap:6}}><Feather name={icon} size={24} color={icon==='clipboard'?colors.text:colors.subText}/><Text style={{fontSize:11,color:icon==='clipboard'?colors.text:colors.subText}}>{label}</Text></View>)}</View>
 </View>;
}
createRoot(document.getElementById('root')!).render(<App/>);
