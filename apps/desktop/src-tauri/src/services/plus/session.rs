//! MQTT network progress is independent of UI visibility and request processing.
//! Never await our own outgoing queue from the task that must drain that queue.
use super::core::Request;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use serde_json::{json, Value};
use std::future::Future;
use tokio::{sync::mpsc, task::JoinHandle};

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;

struct Pump(JoinHandle<Result<(), String>>);
impl Drop for Pump { fn drop(&mut self) { self.0.abort(); } }

fn response(r: &Request, mut value: Value) -> Value {
    value["v"]=json!(1); value["type"]=json!("response");
    value["id"]=json!(r.id); value["requestId"]=json!(r.request_id);
    value["from"]=json!(r.to); value["to"]=json!(r.from); value
}

pub async fn serve<H,F,R>(options:MqttOptions, instance:String, desktop:String, handler:H, ready:R) -> Result<(),String>
where H:Fn(Request)->F, F:Future<Output=Value>, R:Fn()+Send+'static {
    let (client,mut events)=AsyncClient::new(options,32);
    let network_client=client.clone();
    let request_topic=format!("tiezplus/v1/{instance}/request/{desktop}");
    let response_prefix=format!("tiezplus/v1/{instance}/response/");
    let busy_prefix=response_prefix.clone();
    let presence=format!("tiezplus/v1/{instance}/presence/{desktop}");
    // Bounded memory. Busy requests are explicitly rejected, never silently
    // accepted and later replayed after reconnect. Originals remain on the phone.
    let (tx,mut rx)=mpsc::channel::<Request>(32);
    let mut pump=Pump(tokio::spawn(async move {
        let mut subscribed=false;
        loop {
            match events.poll().await.map_err(|_|"Plus 服务连接断开，正在重新连接".to_string())? {
                Event::Incoming(Incoming::ConnAck(_))=>network_client.try_subscribe(&request_topic,QoS::AtLeastOnce).map_err(|_|"SUBSCRIBE_FAILED")?,
                Event::Incoming(Incoming::SubAck(ack))=>{
                    if ack.return_codes.iter().any(|q|matches!(q,rumqttc::SubscribeReasonCode::Failure)){return Err("SUBSCRIBE_DENIED".into());}
                    subscribed=true;
                    network_client.try_publish(&presence,QoS::AtLeastOnce,true,json!({"v":1,"from":desktop,"ready":true}).to_string()).map_err(|_|"PRESENCE_FAILED")?;
                    ready();
                },
                Event::Incoming(Incoming::Publish(packet)) if subscribed && packet.topic==request_topic && !packet.retain=>{
                    let Ok(r)=serde_json::from_slice::<Request>(&packet.payload) else {continue};
                    if r.validate(&desktop).is_err(){continue;}
                    if let Err(error)=tx.try_send(r) {
                        let r=error.into_inner();
                        let value=response(&r,json!({"ok":false,"status":"rejected","error":"电脑正在处理其他请求，文字已保留，请稍后手动重试"}));
                        network_client.try_publish(format!("{busy_prefix}{}",r.from),QoS::AtLeastOnce,false,value.to_string()).map_err(|_|"RESPONSE_QUEUE_FULL")?;
                    }
                }, _=>{}
            }
        }
    }));
    loop {
        let request=tokio::select! {
            outcome=&mut pump.0=>return outcome.map_err(|_|"MQTT 网络任务退出".to_string())?,
            r=rx.recv()=>r.ok_or("MQTT 请求通道关闭")?,
        };
        // Serial processing preserves durable deduplication and clipboard order.
        // The pump continues PUBACK/keepalive while a database/clipboard is busy.
        let value=handler(request.clone()).await;
        if pump.0.is_finished() {return Err("处理期间连接断开；结果已保存，等待手机查询".into());}
        client.publish(format!("{response_prefix}{}",request.from),QoS::AtLeastOnce,false,response(&request,value).to_string()).await.map_err(|_|"RESPONSE_FAILED")?;
    }
}
