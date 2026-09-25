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
  return <div className="plus-status window-no-drag">
    <button className={`plus-status-badge ${status.ready?'ready':''}`} title={`${status.message || '正在连接'}；点击查看连接码。隐藏窗口后仍在后台接收。`}
      aria-label="Plus 连接状态与连接码" aria-expanded={show} onClick={()=>setShow(!show)}>
      <span aria-hidden="true">{status.ready?'●':'○'}</span><span className="plus-status-label">{status.ready?'Plus 已连接':'Plus 未就绪'}</span>
    </button>
    {show && <div className="plus-status-panel window-no-drag" role="dialog" aria-label="Plus 连接详情" onKeyDown={e=>{if(e.key==='Escape')setShow(false);}}>
      <button className="plus-status-close" onClick={()=>setShow(false)} aria-label="关闭连接详情">关闭</button>
      <p>{status.message}</p><p>关闭主窗口只是隐藏到托盘，仍可接收手机推送；托盘菜单“退出”才会停止接收。</p>
      <p>手机打开 TIEZ Plus 即可自动发现。以下二维码仅在自动发现失败时使用。</p>
      {status.endpoint && addresses.map(host=><div key={host} style={{display:'inline-block',padding:8,background:'#fff',color:'#172b42'}}><QRCodeSVG size={160} value={JSON.stringify({product:'tiez-plus',v:1,host,httpPort:status.endpoint!.httpPort})}/><div>{host}</div></div>)}
      {!addresses.length && <p>尚未获取到专用局域网 IPv4 地址，请检查电脑网络。地址会自动刷新。</p>}
      {!status.ready && <p>电脑端需要独立的 TiezPlusBroker 服务。开发/测试期间不会自动安装或启动服务。</p>}
    </div>}
  </div>;
}
