use axum::{
    body::Body,
    extract::{
        ws::{Message as WsMessage, WebSocket},
        Multipart, Path, Query, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Json},
};
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio_util::io::ReaderStream;

use crate::app_state::SettingsState;
use crate::database::DbState;
use crate::infrastructure::repository::settings_repo::SettingsRepository;

use super::models::*;
use super::utils::*;
use super::web_ui::render_index;
use super::register_received_file;

pub async fn index(State(state): State<Arc<AppState>>) -> Html<String> {
    let app_handle = &state.app_handle;
    let settings = app_handle.state::<SettingsState>();
    let db_state = app_handle.state::<DbState>();
    let logo_base64 = get_app_logo_base64(app_handle);
    let theme = {
        let guard = settings.theme.lock().unwrap();
        guard.clone()
    };
    let color_mode = db_state
        .settings_repo
        .get("app.color_mode")
        .ok()
        .flatten()
        .unwrap_or_else(|| "system".to_string());

    Html(render_index(&theme, &color_mode, &logo_base64))
}

pub async fn poll_messages(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<AppState>>,
) -> Json<Vec<Message>> {
    let last_id = params
        .get("last_id")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let chat_state = state.app_handle.state::<ChatState>();

    let msgs_result = {
        match chat_state.0.lock() {
            Ok(msgs) => msgs
                .iter()
                .filter(|m| m.id > last_id)
                .map(|m| {
                    let mut m_clone = m.clone();
                    if m.msg_type == "image"
                        && !m.content.starts_with("data:")
                        && !m.content.starts_with("/download/")
                    {
                        let token = format!("temp_{}", m.id);
                        let mut filename = "image.png".to_string();
                        let path = std::path::Path::new(&m.content);
                        if let Some(name) = path.file_name() {
                            filename = name.to_string_lossy().to_string();
                        }

                        let shared_files = state.app_handle.state::<SharedFileState>();
                        if let Ok(mut map) = shared_files.0.lock() {
                            map.insert(token.clone(), m.content.clone());
                        }
                        m_clone.content = format!(
                            "/download/{}?name={}",
                            token,
                            urlencoding::encode(&filename)
                        );
                    }
                    m_clone
                })
                .collect::<Vec<Message>>(),
            Err(_) => vec![],
        }
    };

    Json(msgs_result)
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

#[derive(serde::Deserialize)]
#[serde(tag = "type")]
enum WsIncoming {
    #[serde(rename = "identity")]
    Identity {
        device_id: String,
        device_name: String,
    },
}

pub async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_tx.subscribe();
    let mut current_device_id: Option<String> = None;

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(WsMessage::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let state_inner = state.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let WsMessage::Text(text) = msg {
                if let Ok(incoming) = serde_json::from_str::<WsIncoming>(&text) {
                    match incoming {
                        WsIncoming::Identity {
                            device_id,
                            device_name,
                        } => {
                            let online_devices = state_inner.app_handle.state::<OnlineDevices>();
                            {
                                let mut guard = online_devices.0.lock().unwrap();
                                guard.insert(
                                    device_id.clone(),
                                    DeviceInfo {
                                        id: device_id.clone(),
                                        name: device_name,
                                        last_seen: chrono::Utc::now().timestamp_millis(),
                                    },
                                );
                                current_device_id = Some(device_id);

                                let devices: Vec<DeviceInfo> = guard.values().cloned().collect();
                                let update = serde_json::json!({
                                    "type": "devices_update",
                                    "devices": devices
                                });
                                let _ = state_inner.ws_tx.send(update.to_string());
                                let _ = state_inner
                                    .app_handle
                                    .emit("online-devices-updated", devices);
                            }
                        }
                    }
                }
            }
        }

        if let Some(id) = current_device_id {
            let online_devices = state_inner.app_handle.state::<OnlineDevices>();
            {
                let mut guard = online_devices.0.lock().unwrap();
                guard.remove(&id);
                let devices: Vec<DeviceInfo> = guard.values().cloned().collect();
                let update = serde_json::json!({
                    "type": "devices_update",
                    "devices": devices
                });
                let _ = state_inner.ws_tx.send(update.to_string());
                let _ = state_inner
                    .app_handle
                    .emit("online-devices-updated", devices);
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }
}

pub async fn handle_text() -> axum::response::Response {
    // Do not leave an alternative pre-ACK text path in the file service.
    (StatusCode::GONE, "Text sending moved to the durable TIEZ Plus MQTT page; files still use this service").into_response()
}

pub async fn upload(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> axum::response::Response {
    update_activity(&state.app_handle);
    let mut success = false;
    let db_state = state.app_handle.state::<DbState>();

    let mut current_sender_id = "mobile".to_string();
    let mut current_sender_name = "手机".to_string();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();

        if name == "sender_id" {
            if let Ok(val) = field.text().await {
                current_sender_id = val;
            }
            continue;
        }
        if name == "sender_name" {
            if let Ok(val) = field.text().await {
                current_sender_name = val;
            }
            continue;
        }

        if name == "file" {
            let file_name = field.file_name().unwrap_or("unknown.txt").to_string();
            if !super::security::valid_filename(&file_name) { return (StatusCode::BAD_REQUEST,"Invalid filename").into_response(); }
            let content_type = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_string();

            let mut save_dir = state
                .app_handle
                .path()
                .download_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            if let Ok(Some(custom)) = db_state.settings_repo.get("file_transfer_path") {
                if !custom.trim().is_empty() {
                    save_dir = std::path::PathBuf::from(custom);
                }
            }
            if !save_dir.exists() {
                let _ = std::fs::create_dir_all(&save_dir);
            }

            let target_path = save_dir.join(format!(
                "{}_{}",
                uuid::Uuid::new_v4(),
                file_name
            ));

            if let Ok(mut file) = File::create(&target_path).await {
                let mut stream = field;
                let mut write_success = true;
                while let Some(result) = stream.next().await {
                    let Ok(chunk) = result else { write_success = false; break; };
                    if let Err(e) = file.write_all(&chunk).await {
                        eprintln!("Error writing: {}", e);
                        write_success = false;
                        break;
                    }
                }

                if write_success {
                    register_received_file(
                        &state.app_handle,
                        target_path,
                        file_name,
                        content_type,
                        current_sender_id.clone(),
                        current_sender_name.clone(),
                    )
                    .await;
                    success = true;
                }
            }
        }
    }

    if success {
        (StatusCode::OK, "Upload successful").into_response()
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, "Upload failed").into_response()
    }
}

pub async fn upload_chunk(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> axum::response::Response {
    update_activity(&state.app_handle);
    let mut metadata: Option<ChunkMetadata> = None;
    let mut chunk_data: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();

        if name == "metadata" {
            if let Ok(bytes) = field.bytes().await {
                if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                    if let Ok(m) = serde_json::from_str(&text) {
                        metadata = Some(m);
                    }
                }
            }
        } else if name == "data" || name == "file" {
            if let Ok(bytes) = field.bytes().await {
                chunk_data = Some(bytes.to_vec());
            }
        }
    }

    let meta = match metadata {
        Some(m) => m,
        None => return (StatusCode::BAD_REQUEST, "Missing metadata").into_response(),
    };
    let data = match chunk_data {
        Some(d) => d,
        None => return (StatusCode::BAD_REQUEST, "Missing data").into_response(),
    };

    receive_chunk(state, meta, data).await
}
#[derive(serde::Deserialize)]
pub struct Base64Chunk { metadata: ChunkMetadata, data_base64: String }
pub async fn upload_chunk_base64(State(state): State<Arc<AppState>>, Json(payload): Json<Base64Chunk>) -> axum::response::Response {
    use base64::Engine;
    let Ok(data) = base64::engine::general_purpose::STANDARD.decode(&payload.data_base64) else {
        return (StatusCode::BAD_REQUEST,"Invalid base64").into_response();
    };
    receive_chunk(state,payload.metadata,data).await
}
async fn receive_chunk(state: Arc<AppState>, meta: ChunkMetadata, data: Vec<u8>) -> axum::response::Response {
    if !super::security::valid_upload_id(&meta.upload_id) || !super::security::valid_filename(&meta.file_name)
        || meta.total_chunks == 0 || meta.total_chunks > 16384 || meta.chunk_index >= meta.total_chunks
        || meta.total_size > 2 * 1024 * 1024 * 1024 || data.len() > 8 * 1024 * 1024 {
        return (StatusCode::BAD_REQUEST,"Invalid chunk metadata or size").into_response();
    }
    let sessions = state.app_handle.state::<UploadSessions>();
    let mut map = sessions.0.lock().await;
    if !map.contains_key(&meta.upload_id) {
        if meta.chunk_index != 0 || map.len() >= 16 { return (StatusCode::CONFLICT,"Upload session missing or full").into_response(); }
        let mut dir = state.app_handle.path().download_dir().unwrap_or_else(|_|std::env::temp_dir());
        if let Ok(Some(custom)) = state.app_handle.state::<DbState>().settings_repo.get("file_transfer_path") {
            if !custom.trim().is_empty() { dir = custom.into(); }
        }
        if tokio::fs::create_dir_all(&dir).await.is_err() { return (StatusCode::INTERNAL_SERVER_ERROR,"Destination unavailable").into_response(); }
        let path = dir.join(format!(".tiezplus_{}.part",uuid::Uuid::new_v4()));
        if tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await.is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR,"Unable to create upload").into_response();
        }
        map.insert(meta.upload_id.clone(),UploadSession{path,next_chunk:0,total_chunks:meta.total_chunks,total_size:meta.total_size,received:0,filename:meta.file_name.clone()});
    }
    let session = map.get_mut(&meta.upload_id).unwrap();
    if session.next_chunk != meta.chunk_index || session.total_chunks != meta.total_chunks || session.total_size != meta.total_size
        || session.filename != meta.file_name || session.received + data.len() as u64 > session.total_size {
        return (StatusCode::CONFLICT,"Out-of-order or inconsistent chunk; restart upload").into_response();
    }
    let final_chunk = meta.chunk_index + 1 == meta.total_chunks;
    if final_chunk && session.received + data.len() as u64 != session.total_size {
        return (StatusCode::BAD_REQUEST,"Incomplete upload").into_response();
    }
    let write_result = async {
        let mut file = tokio::fs::OpenOptions::new().append(true).open(&session.path).await?;
        file.write_all(&data).await?; file.sync_data().await
    }.await;
    if write_result.is_err() { return (StatusCode::INTERNAL_SERVER_ERROR,"Chunk write failed; restart upload").into_response(); }
    session.received += data.len() as u64; session.next_chunk += 1;
    if !final_chunk { return (StatusCode::OK,"Chunk received").into_response(); }
    let final_path = session.path.parent().unwrap().join(format!("{}_{}",uuid::Uuid::new_v4(),meta.file_name));
    if tokio::fs::rename(&session.path,&final_path).await.is_err() { return (StatusCode::INTERNAL_SERVER_ERROR,"Finalize failed").into_response(); }
    map.remove(&meta.upload_id); drop(map);
    register_received_file(&state.app_handle,final_path,meta.file_name,meta.content_type.unwrap_or_else(||"application/octet-stream".into()),meta.sender_id,meta.sender_name).await;
    (StatusCode::OK,"Upload complete").into_response()
}

pub async fn handle_file_download_proxy(
    Path(token): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let app_handle = &state.app_handle;
    update_activity(app_handle);
    let shared_state = app_handle.state::<SharedFileState>();

    let file_path = {
        let guard = shared_state.0.lock().unwrap();
        guard.get(&token).cloned()
    };

    if let Some(path_str) = file_path {
        let path = std::path::PathBuf::from(&path_str);
        if path.exists() {
            let filename = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let mime = mime_guess::from_path(&path)
                .first_or_octet_stream()
                .to_string();
            let is_image = mime.starts_with("image/");
            let is_video = mime.starts_with("video/");
            let encoded_name = urlencoding::encode(&filename);
            let disposition = if is_image || is_video {
                format!(
                    "inline; filename=\"{}\"; filename*=UTF-8''{}",
                    filename, encoded_name
                )
            } else {
                format!(
                    "attachment; filename=\"{}\"; filename*=UTF-8''{}",
                    filename, encoded_name
                )
            };

            if let Ok(mut file) = File::open(&path).await {
                let metadata = match file.metadata().await {
                    Ok(m) => m,
                    Err(_) => {
                        return (StatusCode::INTERNAL_SERVER_ERROR, "Metadata failed")
                            .into_response()
                    }
                };
                let total_size = metadata.len();
                let range_header = headers.get(header::RANGE).and_then(|h| h.to_str().ok());

                if let Some(range) = range_header {
                    if let Some(r) = range.strip_prefix("bytes=") {
                        let parts: Vec<&str> = r.split('-').collect();
                        if parts.len() == 2 {
                            let start = parts[0].parse::<u64>().unwrap_or(0);
                            let end = parts[1].parse::<u64>().unwrap_or(total_size - 1);

                            if start < total_size {
                                let end = if end >= total_size {
                                    total_size - 1
                                } else {
                                    end
                                };
                                let content_length = end - start + 1;

                                if let Ok(_) = file.seek(SeekFrom::Start(start)).await {
                                    let stream = ReaderStream::with_capacity(
                                        file.take(content_length),
                                        64 * 1024,
                                    );
                                    let body = Body::from_stream(stream);

                                    return (
                                        StatusCode::PARTIAL_CONTENT,
                                        [
                                            (header::CONTENT_TYPE, mime),
                                            (header::CONTENT_DISPOSITION, disposition),
                                            (header::ACCEPT_RANGES, "bytes".to_string()),
                                            (
                                                header::CONTENT_RANGE,
                                                format!("bytes {}-{}/{}", start, end, total_size),
                                            ),
                                            (header::CONTENT_LENGTH, content_length.to_string()),
                                        ],
                                        body,
                                    )
                                        .into_response();
                                }
                            }
                        }
                    }
                }

                let stream = ReaderStream::with_capacity(file, 64 * 1024);
                let body = Body::from_stream(stream);

                return (
                    StatusCode::OK,
                    [
                        (header::CONTENT_TYPE, mime),
                        (header::CONTENT_DISPOSITION, disposition),
                        (header::ACCEPT_RANGES, "bytes".to_string()),
                        (header::CONTENT_LENGTH, total_size.to_string()),
                    ],
                    body,
                )
                    .into_response();
            }
        }
    }

    (StatusCode::NOT_FOUND, "File not found").into_response()
}
