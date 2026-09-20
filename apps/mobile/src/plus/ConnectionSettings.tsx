import React, {useEffect,useRef,useState} from 'react';
import {Alert,Modal,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {useTheme} from '../theme/ThemeContext';
import {runtime,subscribe,startDiscovery,stopDiscovery,inspectEndpoint,connect} from './runtime';
import {fetchWebDavEntries,loadMobileSyncSettings,type SyncedEntry} from '../lib/sync';
import {copyText} from './actions';

export default function ConnectionSettings() {
  const {colors:c}=useTheme();const insets=useSafeAreaInsets();
  const [,redraw]=useState(0);const [expanded,setExpanded]=useState(false);
  const [qr,setQr]=useState(false);const qrBusy=useRef(false);
  const [permission,requestPermission]=useCameraPermissions();
  useEffect(()=>subscribe(()=>redraw(v=>v+1)),[]);
  const error=(e:unknown)=>Alert.alert('连接未完成',e instanceof Error?e.message:String(e));
  const button=(title:string,fn:()=>void)=><Pressable accessibilityRole="button" onPress={fn} style={{paddingVertical:12,paddingHorizontal:14,borderRadius:12,backgroundColor:c.iconBackground}}><Text style={{color:c.text,fontSize:14}}>{title}</Text></Pressable>;
  return <View style={{paddingHorizontal:20,paddingVertical:18}}>
    <Pressable accessibilityRole="button" accessibilityLabel="电脑连接设置" style={{flexDirection:'row',alignItems:'center',gap:12}} onPress={()=>setExpanded(!expanded)}>
      <Feather name="monitor" size={19} color={c.text}/><Text style={{flex:1,fontSize:16,color:c.text}}>电脑连接</Text><Text style={{color:c.subText,fontSize:13}}>{runtime.ready?runtime.selected?.name||'已连接':'未就绪'}</Text><Feather name={expanded?'chevron-up':'chevron-down'} size={18} color={c.subText}/>
    </Pressable>
    {expanded&&<View style={{marginTop:18,gap:12}}>
      <Text style={{color:c.text,fontSize:14}}>{runtime.status}</Text>
      <Text style={{color:c.subText,fontSize:12,lineHeight:20}}>服务：{runtime.connection?.connected?'已连接':'未连接'}　电脑：{runtime.ready?'已就绪':'未就绪'}</Text>
      {!!runtime.error&&<Text style={{color:c.subText,fontSize:13,lineHeight:20}}>{runtime.error}</Text>}
      <View style={{flexDirection:'row',gap:10}}>{button('重新发现',()=>{stopDiscovery();void startDiscovery().catch(error);})}{button('扫码连接',()=>{qrBusy.current=false;setQr(true);})}</View>
      {[...runtime.endpoints.values()].filter(e=>Date.now()-e.seen<45000).map(endpoint=><Pressable key={endpoint.instanceId} onPress={()=>{void connect(endpoint);}} style={{padding:12,borderRadius:12,borderWidth:StyleSheet.hairlineWidth,borderColor:c.divider}}><Text style={{color:c.text}}>{runtime.selected?.instanceId===endpoint.instanceId?'● ':'○ '}{endpoint.name}</Text><Text style={{color:c.subText,fontSize:12,marginTop:5}}>{endpoint.host}</Text></Pressable>)}
      <Text style={{color:c.subText,fontSize:12,lineHeight:20}}>同一可信局域网自动连接；多台电脑时在此选择。不自动推送或重发。</Text>
    </View>}
    <Modal visible={qr} animationType="slide" onRequestClose={()=>setQr(false)}><View style={{flex:1,paddingTop:insets.top+20,paddingBottom:insets.bottom+20,paddingHorizontal:20,backgroundColor:c.background}}><Text style={{fontSize:22,fontWeight:'600',color:c.text,marginBottom:18}}>扫描电脑连接码</Text>
      {!permission?.granted?button('允许相机',()=>{void requestPermission();}):<CameraView style={{flex:1,marginBottom:18}} barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>{
        if(qrBusy.current)return;qrBusy.current=true;
        void (async()=>{const raw=data.startsWith('tiezplus://connect?data=')?decodeURIComponent(data.split('?data=')[1]):data;const value=JSON.parse(raw);if(value.product!=='tiez-plus'||value.v!==1)throw new Error('请扫描 TIEZ Plus 连接码');const endpoint=await inspectEndpoint(value.host,value.httpPort);if(!endpoint)throw new Error('正在检查此设备，请稍后再扫');await connect(endpoint);setQr(false);})().catch(e=>{error(e);qrBusy.current=false;});
      }}/>}{button('取消',()=>setQr(false))}
    </View></Modal>
  </View>;
}

// Keep the original advanced WebDAV operation explicit, away from the home flow.
export function WebDavHistoryButton() {
  const {colors:c}=useTheme();const insets=useSafeAreaInsets();const [open,setOpen]=useState(false);const [rows,setRows]=useState<SyncedEntry[]>([]);const [loading,setLoading]=useState(false);
  const read=async()=>{setLoading(true);try{setRows(await fetchWebDavEntries(await loadMobileSyncSettings()));setOpen(true);}catch(e){Alert.alert('读取失败',e instanceof Error?e.message:String(e));}finally{setLoading(false);}};
  return <><Pressable disabled={loading} onPress={()=>void read()} style={{paddingVertical:14}}><Text style={{color:c.text,fontSize:14}}>{loading?'读取中…':'查看 WebDAV 历史'}</Text></Pressable>
    <Modal visible={open} onRequestClose={()=>setOpen(false)} animationType="slide"><View style={{flex:1,backgroundColor:c.background,paddingTop:insets.top+16,paddingHorizontal:20,paddingBottom:insets.bottom+20}}><View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:20}}><Text style={{color:c.text,fontSize:22}}>WebDAV 历史</Text><Pressable onPress={()=>setOpen(false)}><Text style={{color:c.text}}>关闭</Text></Pressable></View><ScrollView>{rows.map(r=><Pressable key={r.id} style={{backgroundColor:c.card,padding:16,marginBottom:12,borderRadius:16}} onPress={()=>{void copyText(r.content,Clipboard.setStringAsync).then(()=>Alert.alert('已复制')).catch(e=>Alert.alert('复制失败',e.message));}}><Text numberOfLines={3} style={{color:c.text,lineHeight:22}}>{r.content}</Text></Pressable>)}</ScrollView></View></Modal>
  </>;
}
