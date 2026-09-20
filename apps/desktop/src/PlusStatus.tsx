import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QRCodeSVG } from 'qrcode.react';
type Status = {ready?:boolean;message?:string;endpoint?:{instanceId:string;httpPort:number;addresses:string[]}};
export default function PlusStatus() {
  const [status,setStatus]=useState<Status>({message:'TIEZ Plus · 正在检查本地服务'});
  const [show,setShow]=useState(false);
  const [addresses,setAddresses]=useState<string[]>([]);
  useEffect(()=>{
    void invoke<Status>('get_plus_status').then(setStatus).catch(()=>setStatus({message:'隔离开发模式，不连接服务或操作剪贴板'}));
    const off=listen<Status>('plus-status',e=>setStatus(e.payload));
    return ()=>{void off.then(fn=>fn());};
  },[]);
  useEffect(()=>{
    if (!show) return;
    let active=true;
    const refresh=()=>{void invoke<string[]>('get_available_ips').then(ips=>{
      if(active) setAddresses(ips.filter(ip=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)));
    }).catch(()=>{if(active) setAddresses([]);});};
    refresh(); const timer=setInterval(refresh,10000);
    return ()=>{active=false;clearInterval(timer);};
  },[show]);
  return <div style={{padding:'5px 12px',fontSize:11,background:'var(--bg-secondary)',borderBottom:'1px solid var(--border-color)'}}>
    <button onClick={()=>setShow(!show)} style={{font: 'inherit',cursor:'pointer',color:status.ready?'#228557':'#a56724'}}>{status.ready?'●':'○'} {status.message} · 连接码</button>
    {show && <div style={{padding:12}}><p>手机打开 TIEZ Plus 即可自动发现。以下二维码仅在自动发现失败时使用。</p>
      {status.endpoint && addresses.map(host=><div key={host} style={{display:'inline-block',padding:8,background:'#fff',color:'#172b42'}}><QRCodeSVG size={160} value={JSON.stringify({product:'tiez-plus',v:1,host,httpPort:status.endpoint!.httpPort})}/><div>{host}</div></div>)}
      {!addresses.length && <p>尚未获取到专用局域网 IPv4 地址，请检查电脑网络。地址会自动刷新。</p>}
      {!status.ready && <p>电脑端需要独立的 TiezPlusBroker 服务。开发/测试期间不会自动安装或启动服务。</p>}
    </div>}
  </div>;
}
