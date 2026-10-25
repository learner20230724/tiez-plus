//! A private, per-user broker lives only while this desktop app runs.
use std::{path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{AppHandle, Manager};
static BROKER: Mutex<Option<Child>> = Mutex::new(None);

pub fn ensure_broker(app: &AppHandle) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("broker");
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let mut child = BROKER.lock().map_err(|_| "Broker lock")?;
    let running = match child.as_mut() {
        Some(process) => process.try_wait().map_err(|e| e.to_string())?.is_none(),
        None => false,
    };
    if !running {
        let runtime = app.path().resource_dir().map_err(|e| e.to_string())?.join("broker-runtime");
        let log = std::fs::OpenOptions::new().create(true).append(true).open(data.join("broker.log")).map_err(|e| e.to_string())?;
        *child = Some(Command::new(runtime.join("node"))
            .arg(runtime.join("services/broker/index.cjs"))
            .env("TIEZ_PLUS_BROKER_DATA", &data)
            .env("TIEZ_PLUS_PARENT_PID", std::process::id().to_string())
            .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
            .stdin(Stdio::null()).stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log)).spawn().map_err(|e| format!("无法启动内置 Plus 服务: {e}"))?);
    }
    Ok(data.join("endpoint.json"))
}
pub fn stop_broker() {
    if let Ok(mut slot) = BROKER.lock() {
        if let Some(mut child) = slot.take() { let _ = child.kill(); let _ = child.wait(); }
    }
}
