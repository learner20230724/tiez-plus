import React, { useMemo } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import type { Draft, Outbox, OutboxSummary } from './store';
import { editorRows } from './actions';

export type RemoteEntry = {id:string; preview:string; timestamp:number; content_type:string};
export type PullCache = {instanceId:string; name:string; at:number; current:{content?:string;error?:string;ok:boolean}; entries:RemoteEntry[]; note?:string};
export type Detail = {title:string;content:string;record?:Outbox;draft?:Draft};
export const stateName: Record<string,string> = {saved:'待推送',sending:'发送中',unconfirmed:'未确认送达',delivered:'已送达',stored:'电脑已保存',copy_failed:'电脑复制失败',unknown:'结果待确认',rejected:'未送达'};
export type HomeViewProps = {
  colors:typeof Colors.light; top:number; bottom:number; keyboard:boolean; loading:boolean;
  mode:'push'|'pull'; setMode:(mode:'push'|'pull')=>void;
  drafts:Draft[]; selected:string[]; edit:(id:string,text:string)=>void; toggle:(id:string)=>void; selectAll:()=>void;
  push:()=>void; pushing:boolean; refreshing:boolean; refresh:()=>void; saveLabel:string; feedback:string;
  pull:PullCache|null; pullError:string; offline:boolean; copyCurrent:()=>void; copyRemote:(e:RemoteEntry)=>void; viewRemote:(e:RemoteEntry)=>void;
  historyOpen:boolean; openHistory:()=>void; closeHistory:()=>void; history:OutboxSummary[]; search:string; searchHistory:(q:string)=>void; historyPage:number; changeHistoryPage:(delta:number)=>void;
  queueHistory:(id:string)=>void; viewHistory:(id:string)=>void;
  detail:Detail|null; showDetail:(d:Detail)=>void; closeDetail:()=>void; copyDetail:()=>void; editDetail:()=>void; deleteDetail:()=>void;
};

export default function HomeView(p:HomeViewProps) {
  const {colors:c}=p;
  const s=useMemo(()=>StyleSheet.create({
    root:{flex:1,backgroundColor:c.background},chrome:{paddingTop:p.top,paddingHorizontal:20,paddingBottom:2},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:14,paddingBottom:18},
    title:{fontSize:36,fontWeight:'700',color:c.text,letterSpacing:.5},historyButton:{flexDirection:'row',alignItems:'center',gap:6,padding:10},small:{color:c.subText,fontSize:12,lineHeight:18},
    segments:{flexDirection:'row',backgroundColor:c.iconBackground,borderRadius:16,padding:4,marginBottom:8},segment:{flex:1,paddingVertical:12,borderRadius:12,alignItems:'center'},segmentText:{color:c.subText,fontSize:15,fontWeight:'600'},
    scroll:{paddingHorizontal:20,paddingTop:14,paddingBottom:p.keyboard?120:210},card:{backgroundColor:c.card,borderRadius:18,padding:16,marginBottom:12,borderWidth:1,borderColor:c.divider},selected:{borderColor:c.primary,borderWidth:1.5},
    body:{fontSize:16,lineHeight:22,color:c.text},meta:{fontSize:12,color:c.subText,marginTop:8},row:{flexDirection:'row',alignItems:'center',gap:10},grow:{flex:1},input:{minHeight:60,maxHeight:200,fontSize:15,lineHeight:22,color:c.text,paddingVertical:14,paddingHorizontal:14,paddingRight:36,textAlignVertical:'top'},
    indicator:{position:'absolute',right:12,bottom:12,padding:4},footer:{position:'absolute',left:20,right:20,bottom:p.keyboard?12:100},actions:{flexDirection:'row',gap:12},button:{flex:1,borderRadius:16,paddingVertical:15,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,borderWidth:1,borderColor:c.divider,backgroundColor:c.card},primary:{backgroundColor:c.primary,borderColor:c.primary},buttonText:{fontSize:16,fontWeight:'600',color:c.text},
    toast:{position:'absolute',alignSelf:'center',bottom:p.keyboard?80:178,backgroundColor:c.card,paddingVertical:10,paddingHorizontal:18,borderRadius:99,borderWidth:1,borderColor:c.divider,zIndex:10},toastText:{fontSize:13,color:c.text},
    modal:{flex:1,backgroundColor:c.background,paddingTop:p.top+12,paddingBottom:Math.max(p.bottom,16)},modalHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,paddingBottom:14},modalTitle:{fontSize:22,fontWeight:'700',color:c.text},iconButton:{padding:10},search:{backgroundColor:c.card,borderRadius:14,padding:14,color:c.text,marginBottom:16},empty:{paddingVertical:36,textAlign:'center',fontSize:14,color:c.subText},full:{fontSize:16,lineHeight:25,color:c.text,paddingHorizontal:20,paddingBottom:20},hint:{marginBottom:10,color:c.subText,fontSize:12,lineHeight:18},detailActions:{flexDirection:'row',gap:10,paddingHorizontal:20,paddingTop:12},
  }),[c,p.top,p.bottom,p.keyboard]);
  const clipboard=p.drafts.find(d=>d.kind==='clipboard');
  const queued=p.drafts.filter(d=>d.content.length>0 && (d.kind==='history'||d.kind==='retry'));
  const count=p.drafts.filter(d=>d.content.length>0).length;
  const check=(id:string)=><Feather name={p.selected.includes(id)?'check-circle':'circle'} size={18} color={p.selected.includes(id)?c.primary:c.subText}/>;
  const closeIcon=(fn:()=>void,label='关闭')=><Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={fn} style={s.iconButton}><Feather name="x" size={22} color={c.text}/></Pressable>;
  return <KeyboardAvoidingView style={s.root} behavior={Platform.OS==='ios'?'padding':'height'}>
    <View style={s.chrome}>
      <View style={s.header}><Text style={s.title}>TieZ Plus</Text><Pressable accessibilityRole="button" accessibilityLabel="查看手机历史" style={s.historyButton} onPress={p.openHistory}><Feather name="clock" size={18} color={c.subText}/><Text style={s.small}>历史</Text></Pressable></View>
      <View style={s.segments}>{(['push','pull'] as const).map(mode=><Pressable accessibilityRole="tab" accessibilityState={{selected:p.mode===mode}} key={mode} onPress={()=>p.setMode(mode)} style={[s.segment,p.mode===mode&&{backgroundColor:c.primary}]}><Text style={[s.segmentText,p.mode===mode&&{color:c.primaryText}]}>{mode==='push'?'推送':'拉取'}</Text></Pressable>)}</View>
    </View>
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={p.refresh} tintColor={c.text}/> }>
      {p.loading ? <ActivityIndicator color={c.text} style={{marginTop:40}}/> : p.mode==='push' ? <>
        <Pressable testID="clipboard-card" accessibilityLabel="当前手机剪贴板" onPress={()=>clipboard?.content&&p.toggle(clipboard.id)} onLongPress={()=>clipboard?.content&&p.showDetail({title:'手机剪贴板',content:clipboard.content})} style={[s.card,clipboard&&p.selected.includes(clipboard.id)&&s.selected]}>
          <Text testID="clipboard-preview" numberOfLines={3} ellipsizeMode="tail" style={s.body}>{clipboard?.content || '手机剪贴板为空'}</Text>
          <View style={[s.row,{justifyContent:'space-between',marginTop:8}]}><Text style={s.small}>当前剪贴板</Text>{clipboard?.content ? check(clipboard.id):null}</View>
        </Pressable>
        {queued.map(d=><Pressable key={d.id} accessibilityLabel="待推送记录" style={[s.card,p.selected.includes(d.id)&&s.selected]} onPress={()=>p.toggle(d.id)} onLongPress={()=>p.showDetail({title:'待推送内容',content:d.content,draft:d})}>
          <Text numberOfLines={3} style={s.body}>{d.content}</Text><View style={[s.row,{justifyContent:'space-between',marginTop:8}]}><Text style={s.small}>{d.kind==='retry'?'重试':'待推送'}</Text>{check(d.id)}</View>
        </Pressable>)}
        {editorRows(p.drafts).map((d,index)=><View key={d.id} style={[s.card,{padding:4},p.selected.includes(d.id)&&d.content.length>0&&s.selected]}>
          <TextInput accessibilityLabel={`输入内容 ${index+1}`} multiline scrollEnabled value={d.content} onChangeText={text=>p.edit(d.id,text)} placeholder={index===0?'在此输入内容…':'继续输入下一条…'} placeholderTextColor={c.subText} style={s.input}/>
          {!!d.content.length&&<Pressable accessibilityRole="checkbox" accessibilityLabel={`选择输入 ${index+1}`} accessibilityState={{checked:p.selected.includes(d.id)}} onPress={()=>p.toggle(d.id)} style={s.indicator}>{check(d.id)}</Pressable>}
        </View>)}
      </> : <>
        <View style={[s.row,{justifyContent:'space-between',marginBottom:14}]}><Text style={s.small}>{p.pull?`${p.pull.name} · ${new Date(p.pull.at).toLocaleTimeString()}${p.offline?' · 离线缓存':''}`:'电脑剪贴板'}</Text><Pressable accessibilityLabel="刷新电脑记录" onPress={p.refresh} style={{padding:8}}><Feather name="refresh-cw" size={18} color={c.text}/></Pressable></View>
        {!!p.pullError&&<Text style={s.hint}>{p.pullError}</Text>}
        {p.pull ? <>
          <Pressable accessibilityLabel="复制电脑当前剪贴板" style={s.card} onPress={p.copyCurrent} onLongPress={()=>typeof p.pull?.current.content==='string'&&p.showDetail({title:'电脑当前内容',content:p.pull.current.content})}>
            <Text numberOfLines={3} style={s.body}>{p.pull.current.content || p.pull.current.error || '电脑剪贴板为空'}</Text><View style={[s.row,{marginTop:8,justifyContent:'space-between'}]}><Text style={s.small}>当前剪贴板</Text><Feather name="copy" size={16} color={c.subText}/></View>
          </Pressable>
          <Text style={[s.hint,{marginTop:8}]}>最近记录 · 点击复制</Text>
          {!!p.pull.note&&<Text style={s.hint}>{p.pull.note}</Text>}
          {p.pull.entries.map(entry=><Pressable accessibilityLabel="复制电脑记录" key={entry.id} style={s.card} onPress={()=>p.copyRemote(entry)} onLongPress={()=>p.viewRemote(entry)}>
            <Text numberOfLines={3} style={s.body}>{entry.preview}</Text><View style={[s.row,{marginTop:8,justifyContent:'space-between'}]}><Text style={s.small}>{new Date(entry.timestamp).toLocaleString()}</Text><Feather name="copy" size={16} color={c.subText}/></View>
          </Pressable>)}
        </> : <Text style={s.empty}>{p.refreshing?'正在拉取…':'暂无电脑记录，下拉刷新'}</Text>}
      </>}
    </ScrollView>
    {p.mode==='push'&&!p.loading&&<View style={s.footer}>
      {!!p.saveLabel&&<Text style={[s.hint,{textAlign:'center',marginBottom:8}]}>{p.saveLabel}</Text>}
      <View style={s.actions}><Pressable accessibilityRole="button" style={s.button} onPress={p.selectAll}><Feather name="check-square" size={18} color={c.text}/><Text style={s.buttonText}>{count>0&&p.selected.filter(id=>p.drafts.some(d=>d.id===id&&d.content.length)).length===count?'取消全选':'全选'}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="推送所选内容" disabled={p.pushing} style={[s.button,s.primary,p.pushing&&{opacity:.7}]} onPress={p.push}>{p.pushing?<ActivityIndicator size="small" color={c.primaryText}/>:<Feather name="upload-cloud" size={18} color={c.primaryText}/>}<Text style={[s.buttonText,{color:c.primaryText}]}>推送</Text></Pressable>
      </View>
    </View>}
    {!!p.feedback&&<View pointerEvents="none" style={s.toast}><Text style={s.toastText}>{p.feedback}</Text></View>}
    <Modal visible={p.historyOpen} animationType="slide" onRequestClose={p.closeHistory}>
      <View style={s.modal}><View style={s.modalHeader}><Text style={s.modalTitle}>手机历史</Text>{closeIcon(p.closeHistory)}</View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:20,paddingBottom:24}}>
        <TextInput accessibilityLabel="搜索手机历史" value={p.search} onChangeText={p.searchHistory} placeholder="搜索历史" placeholderTextColor={c.subText} style={s.search}/>
        <Text style={s.hint}>点击加入待推送 · 长按查看全文</Text>
        {p.history.map(r=><Pressable key={r.id} accessibilityLabel="加入待推送" style={s.card} onPress={()=>p.queueHistory(r.id)} onLongPress={()=>p.viewHistory(r.id)}>
          <Text numberOfLines={3} style={s.body}>{r.preview}</Text><View style={[s.row,{justifyContent:'space-between',marginTop:8}]}><Text style={s.small}>{stateName[r.status]||r.status} · {new Date(r.created_at).toLocaleString()}</Text><Pressable accessibilityLabel="查看历史详情" onPress={e=>{e.stopPropagation();p.viewHistory(r.id);}} style={{padding:6}}><Feather name="more-horizontal" size={18} color={c.subText}/></Pressable></View>
        </Pressable>)}
        {!p.history.length&&<Text style={s.empty}>暂无记录</Text>}
        <View style={s.row}>{p.historyPage>0&&<Pressable style={s.button} onPress={()=>p.changeHistoryPage(-1)}><Text style={s.buttonText}>上一页</Text></Pressable>}{p.history.length===100&&<Pressable style={s.button} onPress={()=>p.changeHistoryPage(1)}><Text style={s.buttonText}>下一页</Text></Pressable>}</View>
      </ScrollView></View>
    </Modal>
    <Modal visible={!!p.detail} animationType="slide" onRequestClose={p.closeDetail}>
      <View style={s.modal}><View style={s.modalHeader}><Text style={s.modalTitle}>{p.detail?.title}</Text>{closeIcon(p.closeDetail)}</View>
        {p.detail?.record&&<Text style={[s.hint,{paddingHorizontal:20}]}>{stateName[p.detail.record.status]}{p.detail.record.error?` · ${p.detail.record.error}`:''}</Text>}
        <ScrollView><Text selectable style={s.full}>{p.detail?.content}</Text></ScrollView>
        <View style={s.detailActions}><Pressable style={s.button} onPress={p.copyDetail}><Text style={s.buttonText}>复制</Text></Pressable><Pressable style={s.button} onPress={p.editDetail}><Text style={s.buttonText}>编辑</Text></Pressable>{p.detail?.record&&<Pressable style={s.button} onPress={p.deleteDetail}><Text style={s.buttonText}>删除</Text></Pressable>}</View>
      </View>
    </Modal>
  </KeyboardAvoidingView>;
}
