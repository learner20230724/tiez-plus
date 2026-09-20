//! Durable receipt state machine. No OS or Tauri calls: safe to test against temporary SQLite.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_TEXT_BYTES: usize = 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub v: u8, pub id: String, #[serde(rename="requestId")] pub request_id: String,
    pub from: String, pub to: String, #[serde(rename="type")] pub kind: String,
    #[serde(default)] pub content: Option<String>, #[serde(default, rename="entryId")] pub entry_id: Option<String>,
}
pub fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }
impl Request {
    pub fn validate(&self, desktop: &str) -> Result<(), String> {
        if self.v != 1 || self.to != desktop || ![&self.id,&self.request_id,&self.from,&self.to].iter().all(|s| valid_id(s)) { return Err("INVALID_REQUEST".into()); }
        if !["send_text","delivery_status","get_current","get_history","get_content","ping"].contains(&self.kind.as_str()) { return Err("UNSUPPORTED_PROTOCOL".into()); }
        if self.kind == "send_text" {
            let text = self.content.as_deref().ok_or("EMPTY_TEXT")?;
            if text.trim().is_empty() { return Err("EMPTY_TEXT".into()); }
            if text.len() > MAX_TEXT_BYTES { return Err("TEXT_TOO_LARGE".into()); }
        }
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub struct Receipt { pub status: String, pub entry_id: i64 }
pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS plus_receipts(sender TEXT NOT NULL,message_id TEXT NOT NULL,content_hash TEXT NOT NULL,original_content TEXT NOT NULL,
        entry_id INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(sender,message_id));
      UPDATE plus_receipts SET status='unknown' WHERE status='applying';").map_err(|e|e.to_string())
}
pub fn receipt(conn: &Connection, sender: &str, id: &str) -> Result<Option<Receipt>, String> {
    conn.query_row("SELECT status,entry_id FROM plus_receipts WHERE sender=? AND message_id=?",params![sender,id], |r| Ok(Receipt{status:r.get(0)?,entry_id:r.get(1)?})).optional().map_err(|e|e.to_string())
}
pub fn stage(conn: &Connection, r: &Request, encrypted_original: &str, save: impl FnOnce(&Connection) -> Result<i64,String>) -> Result<Receipt,String> {
    let digest = format!("{:x}", Sha256::digest(r.content.as_deref().ok_or("EMPTY_TEXT")?.as_bytes()));
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e|e.to_string())?;
    let result = (|| {
        let existing: Option<(String,String,i64)> = conn.query_row("SELECT content_hash,status,entry_id FROM plus_receipts WHERE sender=? AND message_id=?",params![r.from,r.id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(|e|e.to_string())?;
        if let Some((hash,status,entry_id)) = existing {
            if hash != digest { return Err("MESSAGE_ID_CONTENT_MISMATCH".into()); }
            return Ok(Receipt{status,entry_id});
        }
        let entry_id = save(conn)?;
        conn.execute("INSERT INTO plus_receipts VALUES(?,?,?,?,?,'stored')",params![r.from,r.id,digest,encrypted_original,entry_id]).map_err(|e|e.to_string())?;
        Ok(Receipt { status:"stored".into(), entry_id })
    })();
    match result {
        Ok(value) => {
            if let Err(error) = conn.execute_batch("COMMIT") { let _ = conn.execute_batch("ROLLBACK"); return Err(error.to_string()); }
            Ok(value)
        },
        Err(error) => { let _ = conn.execute_batch("ROLLBACK"); Err(error) }
    }
}
pub fn set_state(conn: &Connection, r: &Request, state: &str) -> Result<(), String> {
    conn.execute("UPDATE plus_receipts SET status=? WHERE sender=? AND message_id=?",params![state,r.from,r.id]).map_err(|e|e.to_string())?; Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    fn req(text: &str) -> Request { Request{v:1,id:"msg-1".into(),request_id:"request-1".into(),from:"phone".into(),to:"pc".into(),kind:"send_text".into(),content:Some(text.into()),entry_id:None} }
    #[test] fn exact_text_durable_dedup_and_crash_recovery() {
        let conn=Connection::open_in_memory().unwrap(); init(&conn).unwrap();
        conn.execute_batch("CREATE TABLE history(id INTEGER PRIMARY KEY,content TEXT)").unwrap();
        let text=format!("  {}\r\n\t🙂  ","长文本".repeat(10000)); let r=req(&text);
        let save=|c:&Connection| { c.execute("INSERT INTO history(content) VALUES(?)",[&text]).unwrap(); Ok(c.last_insert_rowid()) };
        assert_eq!(stage(&conn,&r,&text,save).unwrap().status,"stored");
        assert_eq!(stage(&conn,&r,&text, |_|panic!("duplicate insert")).unwrap().entry_id,1);
        set_state(&conn,&r,"applying").unwrap(); init(&conn).unwrap();
        assert_eq!(receipt(&conn,"phone","msg-1").unwrap().unwrap().status,"unknown");
        set_state(&conn,&r,"delivered").unwrap();
        assert_eq!(stage(&conn,&r,&text, |_|panic!("delivered duplicate")).unwrap().status,"delivered");
        assert_eq!(conn.query_row::<String,_,_>("SELECT content FROM history",[],|r|r.get(0)).unwrap(),text);
        assert!(stage(&conn,&req("changed"),"changed", |_|Ok(2)).is_err());
    }
    #[test] fn failed_save_rolls_back_receipt() {
        let conn=Connection::open_in_memory().unwrap(); init(&conn).unwrap();
        assert!(stage(&conn,&req("text"),"text", |_|Err("disk full".into())).is_err());
        assert!(receipt(&conn,"phone","msg-1").unwrap().is_none());
    }
    #[test] fn bytes_not_characters_limit() {
        assert!(req(&"🙂".repeat(MAX_TEXT_BYTES/4)).validate("pc").is_ok());
        assert!(req(&"🙂".repeat(MAX_TEXT_BYTES/4+1)).validate("pc").is_err());
    }
}
