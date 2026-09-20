pub mod core;
use crate::{app_state::{SettingsState,SessionHistory}, database::DbState, domain::models::ClipboardEntry};
use crate::infrastructure::repository::clipboard_repo::ClipboardRepository;
use crate::services::clipboard::contains_sensitive_info;
use rumqttc::{AsyncClient, Event, Incoming, LastWill, MqttOptions, QoS};
use serde_json::{json,Value};
use std::{sync::{Mutex,OnceLock,atomic::Ordering},time::{Duration,SystemTime,UNIX_EPOCH}};
use tauri::{AppHandle,Emitter,Manager};

static STATUS: OnceLock<Mutex<Value>> = OnceLock::new();
pub fn sandbox() -> bool { cfg!(debug_assertions) || std::env::var("TIEZ_PLUS_SANDBOX").as_deref() == Ok("1") }
fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64 }
fn status(app:&AppHandle, value:Value) { *STATUS.get_or_init(||Mutex::new(json!({}))).lock().unwrap()=value.clone(); let _=app.emit("plus-status",value); }
#[tauri::command] pub fn get_plus_status() -> Value { STATUS.get_or_init(||Mutex::new(json!({"ready":false,"message":"Plus 服务尚未连接"}))).lock().unwrap().clone() }
fn sensitive(app:&AppHandle,text:&str) -> bool {
    let s=app.state::<SettingsState>();
    let kinds=s.privacy_protection_kinds.lock().unwrap().clone();
    let rules=s.privacy_protection_custom_rules.lock().unwrap().clone();
    s.privacy_protection.load(Ordering::Relaxed) && contains_sensitive_info(text,&kinds,&rules)
}
fn exportable(app:&AppHandle,e:&ClipboardEntry) -> bool {
    crate::database::is_text_type(&e.content_type) && !crate::database::has_sensitive_tag(&e.tags) && !sensitive(app,&e.content)
}
fn entry(app:&AppHandle,id:i64) -> Result<Option<ClipboardEntry>,String> {
    if id < 0 { return Ok(app.state::<SessionHistory>().0.lock().map_err(|_|"HISTORY_LOCK")?.iter().find(|e|e.id==id).cloned()); }
    app.state::<DbState>().repo.get_entry_by_id(id)
}
async fn handle(app:&AppHandle,r:&core::Request) -> Result<Value,String> {
    match r.kind.as_str() {
        "ping" => Ok(json!({"ok":true})),
        "delivery_status" => {
            let db=app.state::<DbState>(); let conn=db.conn.lock().map_err(|_|"DB_LOCK")?;
            let receipt=core::receipt(&conn,&r.from,&r.id)?;
            Ok(json!({"status":receipt.map(|v|v.status).unwrap_or_else(||"not_found".into())}))
        },
        "send_text" => {
            let text=r.content.as_deref().ok_or("EMPTY_TEXT")?;
            // Receipt originals are always DPAPI-protected, regardless of preview masking settings.
            let protected=crate::infrastructure::encryption::encrypt_value(text).ok_or("无法加密保存，未修改剪贴板")?;
            let mut e=ClipboardEntry{id:0,content_type:"text".into(),content:text.into(),html_content:None,source_app:"TIEZ Plus 手机".into(),source_app_path:None,timestamp:now(),preview:text.chars().take(200).collect(),is_pinned:false,tags:vec![],use_count:0,is_external:false,pinned_order:0,file_preview_exists:true};
            if sensitive(app,text) {e.tags.push("sensitive".into());}
            let staged={
                let db=app.state::<DbState>(); let conn=db.conn.lock().map_err(|_|"DB_LOCK")?;
                core::stage(&conn,r,&protected,|c|db.repo.save_with_conn(c,&e,None))?
            };
            e.id=staged.entry_id;
            if staged.status=="delivered" || staged.status=="unknown" || staged.status=="applying" {
                return Ok(json!({"status":if staged.status=="applying" {"unknown"} else {staged.status.as_str()},"error":if staged.status=="delivered" {Value::Null} else {json!("电脑曾在处理途中退出，结果待确认；不会自动重复写入")}}));
            }
            let _=app.emit("clipboard-updated",&e);
            {
                let db=app.state::<DbState>(); let conn=db.conn.lock().map_err(|_|"DB_LOCK")?;
                core::set_state(&conn,r,"applying")?;
            }
            let copied=if sandbox() { Err("隔离模式不允许写系统剪贴板".to_string()) }
                else { crate::services::clipboard_ops::prepare_clipboard_payload(text,"text",None,false).await.map_err(|_|"电脑已保存，但剪贴板写入失败".to_string()) };
            let next=if copied.is_ok(){"delivered"}else{"copy_failed"};
            let db=app.state::<DbState>(); let conn=db.conn.lock().map_err(|_|"DB_LOCK")?;
            if core::set_state(&conn,r,next).is_err() { return Ok(json!({"status":"unknown","error":"处理结果保存失败；内容已保存，剪贴板结果待确认"})); }
            Ok(json!({"status":next,"error":copied.err()}))
        },
        "get_current" => {
            if sandbox() {return Err("隔离模式不读取系统剪贴板".into());}
            let text=tauri::async_runtime::spawn_blocking(|| {
                let mut clipboard=arboard::Clipboard::new().map_err(|_|"无法打开电脑剪贴板")?;
                clipboard.get_text().map_err(|_|"电脑剪贴板为空或当前内容不是文字")
            }).await.map_err(|_|"剪贴板读取任务失败")??;
            if text.is_empty(){return Err("电脑剪贴板为空".into());}
            if text.len()>core::MAX_TEXT_BYTES {return Err("当前文字超过 1 MiB，未截断或传输".into());}
            if sensitive(app,&text) {return Err("当前内容受敏感信息保护，不能远程导出".into());}
            let db=app.state::<DbState>();
            if let Some(id)=db.repo.get_entry_by_content(&text,None)? {
                if let Some(e)=db.repo.get_entry_by_id(id)? {if !exportable(app,&e){return Err("当前内容受敏感标签保护".into());}}
            }
            Ok(json!({"ok":true,"content":text,"timestamp":now()}))
        },
        "get_history" => {
            let ids={
                let db=app.state::<DbState>(); let conn=db.conn.lock().map_err(|_|"DB_LOCK")?;
                let mut stmt=conn.prepare("SELECT id FROM clipboard_history WHERE content_type IN ('text','code','url','rich_text') ORDER BY timestamp DESC,id DESC LIMIT 1000").map_err(|e|e.to_string())?;
                let rows=stmt.query_map([],|row|row.get::<_,i64>(0)).map_err(|e|e.to_string())?;
                rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
            };
            let mut all:Vec<ClipboardEntry>=Vec::new();
            for id in ids {if let Some(e)=entry(app,id)? {if exportable(app,&e) {all.push(e);}}}
            all.extend(app.state::<SessionHistory>().0.lock().map_err(|_|"HISTORY_LOCK")?.iter().filter(|e|e.id<0 && exportable(app,e)).cloned());
            all.sort_by(|a,b|b.timestamp.cmp(&a.timestamp).then(b.id.cmp(&a.id)));
            let list:Vec<Value>=all.iter().take(50).map(|e|json!({"id":e.id.to_string(),"preview":e.content.chars().take(200).collect::<String>(),"timestamp":e.timestamp,"content_type":e.content_type})).collect();
            Ok(json!({"ok":true,"entries":list}))
        },
        "get_content" => {
            let id=r.entry_id.as_deref().ok_or("INVALID_ENTRY")?.parse::<i64>().map_err(|_|"INVALID_ENTRY")?;
            let e=entry(app,id)?.ok_or("记录已删除或不再可用")?;
            if !exportable(app,&e){return Err("该记录受隐私保护或不是文字，不能导出".into());}
            let text=if e.content_type=="rich_text" {crate::services::clipboard::derive_rich_text_content(&e.content,e.html_content.as_deref())} else {e.content};
            if text.len()>core::MAX_TEXT_BYTES{return Err("文字超过 1 MiB，未截断或传输".into());}
            Ok(json!({"ok":true,"content":text}))
        },
        _=>Err("UNSUPPORTED_PROTOCOL".into())
    }
}
async fn run(app:AppHandle)->Result<(),String> {
    let endpoint_file=std::path::PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_|"C:\\ProgramData".into())).join("TIEZ Plus/broker/endpoint.json");
    let endpoint:Value=serde_json::from_slice(&std::fs::read(endpoint_file).map_err(|_|"Plus 后台服务未安装或未启动")?).map_err(|_|"服务配置损坏")?;
    let port=endpoint["httpPort"].as_u64().filter(|p|*p>0&&*p<=65535).ok_or("服务端口无效")?;
    let http=reqwest::Client::builder().timeout(Duration::from_secs(4)).build().map_err(|_|"HTTP_INIT")?;
    let enrollment:Value=http.post(format!("http://127.0.0.1:{port}/api/v1/enroll")).json(&json!({"role":"desktop","name":"TIEZ Plus Desktop"})).send().await.map_err(|_|"无法连接 Plus 服务")?.error_for_status().map_err(|_|"服务注册失败")?.json().await.map_err(|_|"服务响应格式错误")?;
    let desktop=enrollment["desktopId"].as_str().filter(|s|core::valid_id(s)).ok_or("INVALID_DESKTOP")?.to_string();
    let instance=enrollment["instanceId"].as_str().filter(|s|core::valid_id(s)).ok_or("INVALID_INSTANCE")?.to_string();
    let tcp=enrollment["mqttPort"].as_u64().filter(|p|*p>0&&*p<=65535).ok_or("INVALID_PORT")? as u16;
    let mut options=MqttOptions::new(&desktop,"127.0.0.1",tcp);
    options.set_credentials(&desktop,enrollment["token"].as_str().ok_or("INVALID_TOKEN")?);
    options.set_clean_session(true);options.set_keep_alive(Duration::from_secs(15));options.set_max_packet_size(core::MAX_TEXT_BYTES*7,core::MAX_TEXT_BYTES*7);
    let presence=format!("tiezplus/v1/{instance}/presence/{desktop}");
    options.set_last_will(LastWill::new(&presence,json!({"v":1,"from":desktop,"ready":false}).to_string(),QoS::AtLeastOnce,true));
    let(client,mut events)=AsyncClient::new(options,32);
    let request_topic=format!("tiezplus/v1/{instance}/request/{desktop}");
    let mut subscribed=false;
    loop {
        match events.poll().await.map_err(|_|"Plus 服务连接断开，正在重新连接")? {
            Event::Incoming(Incoming::ConnAck(_))=>{client.subscribe(&request_topic,QoS::AtLeastOnce).await.map_err(|_|"SUBSCRIBE_FAILED")?;},
            Event::Incoming(Incoming::SubAck(ack))=>{
                if ack.return_codes.iter().any(|q|matches!(q,rumqttc::SubscribeReasonCode::Failure)){return Err("SUBSCRIBE_DENIED".into());}
                subscribed=true;
                client.publish(&presence,QoS::AtLeastOnce,true,json!({"v":1,"from":desktop,"ready":true}).to_string()).await.map_err(|_|"PRESENCE_FAILED")?;
                status(&app,json!({"ready":true,"message":"Plus 服务已连接，可接收手机文字","endpoint":{"instanceId":instance,"httpPort":port,"addresses":enrollment["addresses"]}}));
            },
            Event::Incoming(Incoming::Publish(packet)) if subscribed && packet.topic==request_topic && !packet.retain=>{
                let Ok(r)=serde_json::from_slice::<core::Request>(&packet.payload) else {continue};
                if r.validate(&desktop).is_err(){continue;}
                let mut response=handle(&app,&r).await.unwrap_or_else(|error|json!({"ok":false,"status":if r.kind=="send_text" {"rejected"}else{"error"},"error":error}));
                response["v"]=json!(1);response["type"]=json!("response");response["id"]=json!(r.id);response["requestId"]=json!(r.request_id);response["from"]=json!(desktop);response["to"]=json!(r.from);
                client.publish(format!("tiezplus/v1/{instance}/response/{}",r.from),QoS::AtLeastOnce,false,response.to_string()).await.map_err(|_|"RESPONSE_FAILED")?;
            },_=>{}
        }
    }
}
pub fn start(app:AppHandle) {
    if sandbox(){return;}
    {
        let db=app.state::<DbState>();
        let result=db.conn.lock().map_err(|_|"DB_LOCK".to_string()).and_then(|conn|core::init(&conn));
        if result.is_err(){status(&app,json!({"ready":false,"message":"Plus 送达数据库初始化失败，未启动接收"}));return;}
    }
    tauri::async_runtime::spawn(async move {loop {
        if let Err(error)=run(app.clone()).await{status(&app,json!({"ready":false,"message":error}));}
        tokio::time::sleep(Duration::from_secs(5)).await;
    }});
}
