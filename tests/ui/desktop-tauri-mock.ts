// Visual/interaction fixture, never invokes a native API or a real clipboard.
export const qa={drags:0,calls:[] as string[]};
(window as any).__qa=qa;
export function getCurrentWindow(){return {startDragging:async()=>{qa.drags++;}};}
export async function invoke(command:string){qa.calls.push(command);
  if(command==='get_plus_status')return {ready:true,message:'Plus 服务已连接，可在后台接收手机文字',endpoint:{instanceId:'test',httpPort:18083,addresses:[]}};
  if(command==='get_available_ips')return ['192.168.1.2'];
}
export async function listen(){return ()=>{};}
