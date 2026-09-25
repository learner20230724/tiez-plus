use super::*;
use std::{io::{BufRead,BufReader},process::{Child,Command,Stdio},time::Duration};

struct Fixture { child:Child, dir:std::path::PathBuf, root:std::path::PathBuf }
impl Drop for Fixture {
    fn drop(&mut self) {
        let _=self.child.kill(); let _=self.child.wait();
        if self.dir.canonicalize().map(|p|p.starts_with(&self.root)).unwrap_or(false) {let _=std::fs::remove_dir_all(&self.dir);}
    }
}

#[test]
fn plus_background_network_progress_during_slow_processing_and_burst() {
    let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap();
    let dir=root.join(".runtime").join(format!("rust-session-{}",uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut child=Command::new("node").current_dir(&root).arg("tests/fixtures/rust-session-broker.cjs").arg(dir.strip_prefix(&root).unwrap())
        .stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
    let stdout=child.stdout.take().unwrap();
    let fixture=Fixture{child,dir,root};
    let mut line=String::new(); BufReader::new(stdout).read_line(&mut line).unwrap();
    let info:Value=serde_json::from_str(&line).expect("private broker started");
    tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap().block_on(async {
        tokio::time::timeout(Duration::from_secs(30),async {
            let instance=info["endpoint"]["instanceId"].as_str().unwrap().to_string();
            let desktop=info["desktop"]["deviceId"].as_str().unwrap().to_string();
            let mobile=info["mobile"]["deviceId"].as_str().unwrap().to_string();
            let options=|role:&str| {
                let id=info[role]["deviceId"].as_str().unwrap();
                let mut o=MqttOptions::new(id,"127.0.0.1",info["endpoint"]["mqttPort"].as_u64().unwrap() as u16);
                o.set_credentials(id,info[role]["token"].as_str().unwrap());o.set_keep_alive(Duration::from_secs(5));o.set_max_packet_size(7*1024*1024,7*1024*1024);o
            };
            let (ready_tx,mut ready_rx)=mpsc::unbounded_channel();
            let receiver=tokio::spawn(serve(options("desktop"),instance.clone(),desktop.clone(),|r|async move {
                // Simulates a slow durable write, with NO Windows clipboard / UI.
                if r.kind=="send_text" {tokio::time::sleep(Duration::from_millis(8500)).await;}
                json!({"ok":true,"status":"delivered","echo":r.content})
            },move ||{let _=ready_tx.send(());}));
            ready_rx.recv().await.unwrap();
            let (phone,mut events)=AsyncClient::new(options("mobile"),128);
            let (responses,mut received)=mpsc::unbounded_channel();
            let (subscribed,mut subscription)=mpsc::unbounded_channel();
            let reader=tokio::spawn(async move {
                loop {match events.poll().await.unwrap() {
                    Event::Incoming(Incoming::SubAck(_))=>{let _=subscribed.send(());},
                    Event::Incoming(Incoming::Publish(p))=>{let _=responses.send(serde_json::from_slice::<Value>(&p.payload).unwrap());},_=>{}
                }}
            });
            phone.subscribe(format!("tiezplus/v1/{instance}/response/{mobile}"),QoS::AtLeastOnce).await.unwrap();subscription.recv().await.unwrap();
            let text="  万字中文🙂\n code();  ".repeat(10000);
            let request=|i:usize|Request{v:1,id:format!("m{i}"),request_id:format!("r{i}"),from:mobile.clone(),to:desktop.clone(),kind:if i==0 {"send_text"}else{"ping"}.into(),content:if i==0{Some(text.clone())}else{None},entry_id:None};
            let topic=format!("tiezplus/v1/{instance}/request/{desktop}");
            phone.publish(&topic,QoS::AtLeastOnce,false,serde_json::to_vec(&request(0)).unwrap()).await.unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            for i in 1..49 {phone.publish(&topic,QoS::AtLeastOnce,false,serde_json::to_vec(&request(i)).unwrap()).await.unwrap();}
            let mut ids=std::collections::HashSet::new();
            while ids.len()<49 {
                let r=received.recv().await.unwrap();
                if r["id"]=="m0" {assert_eq!(r["echo"].as_str().unwrap(),text);}
                assert!(r["status"]=="delivered" || r["status"]=="rejected");
                ids.insert(r["id"].as_str().unwrap().to_string());
            }
            assert!(!receiver.is_finished(),"keepalive must survive slow work and a full request queue");
            receiver.abort();reader.abort();
        }).await.expect("bounded session test");
    });
    drop(fixture);
}
