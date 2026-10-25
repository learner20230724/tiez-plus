//! Native macOS implementations for the shared desktop interfaces.
pub mod win_clipboard {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSString, NSArray};
    use objc2::runtime::AnyObject;
    #[derive(Clone)]
    pub struct ImageData { pub width: usize, pub height: usize, pub bytes: Vec<u8> }
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct NamedClipboardFormat { pub name: String, pub data: Vec<u8> }
    pub fn get_clipboard_sequence_number() -> u32 { NSPasteboard::generalPasteboard().changeCount() as u32 }
    pub unsafe fn get_clipboard_image() -> Option<ImageData> {
        let image = arboard::Clipboard::new().ok()?.get_image().ok()?;
        Some(ImageData { width: image.width, height: image.height, bytes: image.bytes.into_owned() })
    }
    pub unsafe fn get_clipboard_files() -> Option<Vec<String>> {
        let list = NSPasteboard::generalPasteboard().propertyListForType(&NSString::from_str("NSFilenamesPboardType"))?;
        let array = list.downcast::<NSArray<AnyObject>>().ok()?;
        let paths: Option<Vec<String>> = array.iter().map(|v| v.downcast::<NSString>().ok().map(|s| s.to_string())).collect();
        paths.filter(|v| !v.is_empty())
    }
    pub unsafe fn get_clipboard_raw_format(name: &str) -> Option<Vec<u8>> {
        if name != "HTML Format" { return None; }
        NSPasteboard::generalPasteboard().stringForType(&NSString::from_str("public.html")).map(|s| s.to_string().into_bytes())
    }
    pub unsafe fn set_clipboard_files(paths: Vec<String>) -> Result<(), String> {
        if paths.is_empty() || paths.iter().any(|p| !std::path::Path::new(p).is_absolute() || !std::path::Path::new(p).exists()) {
            return Err("文件不存在或路径无效".into());
        }
        let names: Vec<_> = paths.iter().map(|s| NSString::from_str(s)).collect();
        let array = NSArray::from_retained_slice(&names);
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        if board.setPropertyList_forType(&array, &NSString::from_str("NSFilenamesPboardType")) { Ok(()) }
        else { Err("写入 Finder 文件剪贴板失败".into()) }
    }
    pub unsafe fn set_clipboard_text_and_html(text: &str, html: &str) -> Result<(), String> {
        let html = crate::services::clipboard::parse_cf_html(html.as_bytes()).unwrap_or_else(|| html.to_owned());
        arboard::Clipboard::new().map_err(|e| e.to_string())?.set_html(html, Some(text.to_owned())).map_err(|e| e.to_string())
    }
    pub unsafe fn append_clipboard_text_and_html(text: &str, html: &str) -> Result<(), String> {
        set_clipboard_text_and_html(text, html)
    }
    pub unsafe fn get_named_clipboard_formats(_: usize, _: usize, _: usize) -> Vec<NamedClipboardFormat> { vec![] }
    pub unsafe fn append_named_clipboard_formats(formats: &[NamedClipboardFormat]) -> Result<(), String> {
        if formats.is_empty() { Ok(()) } else { Err("Windows 专有剪贴板格式无法写入 macOS".into()) }
    }
    pub fn set_clipboard_image_with_formats(data: ImageData, _: Option<&[u8]>, _: Option<&[u8]>) -> Result<Option<String>, String> {
        arboard::Clipboard::new().map_err(|e| e.to_string())?.set_image(arboard::ImageData { width: data.width, height: data.height, bytes: data.bytes.into() }).map_err(|e| e.to_string())?;
        Ok(None)
    }
}
pub mod window_tracker {
    use objc2_app_kit::{NSWorkspace, NSRunningApplication, NSApplicationActivationOptions};
    use std::sync::atomic::{AtomicI32, Ordering};
    static LAST_APP: AtomicI32 = AtomicI32::new(0);
    #[derive(Debug, Clone, Default)]
    pub struct ActiveAppInfo { pub app_name: String, pub process_path: Option<String> }
    pub fn start_window_tracking(app: tauri::AppHandle) {
        std::thread::spawn(move || loop {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = &handle;
                if let Some(front) = NSWorkspace::sharedWorkspace().frontmostApplication() {
                    let pid = front.processIdentifier();
                    if pid > 0 && pid != std::process::id() as i32 { LAST_APP.store(pid, Ordering::Relaxed); }
                }
            });
            std::thread::sleep(std::time::Duration::from_millis(200));
        });
    }
    pub fn get_active_app_info() -> ActiveAppInfo {
        let front = NSWorkspace::sharedWorkspace().frontmostApplication();
        ActiveAppInfo { app_name: front.as_ref().and_then(|f| f.localizedName()).map(|s| s.to_string()).unwrap_or_else(|| "macOS".into()), process_path: None }
    }
    pub fn get_clipboard_source_app_info() -> ActiveAppInfo { get_active_app_info() }
    pub fn restore_focus(app: tauri::AppHandle) -> Result<(), String> {
        let pid = LAST_APP.load(Ordering::Relaxed);
        if pid <= 0 { return Err("尚未记录粘贴目标应用".into()); }
        app.run_on_main_thread(move || {
            if let Some(target) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
                #[allow(deprecated)]
                target.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
            }
        }).map_err(|e| e.to_string())
    }
}
pub mod apps {
    pub async fn launch_uwp_with_file(_: &str, _: &str) -> Result<(), String> { Err("macOS 不支持 Windows UWP 应用".into()) }
    #[tauri::command]
    pub fn get_system_default_app(_ext: &str) -> String { String::new() }
    #[tauri::command]
    pub fn get_executable_icon(_executable_path: String) -> Result<Option<String>, String> { Ok(None) }
    #[tauri::command]
    pub fn get_file_icon(_file_path: String) -> Result<Option<String>, String> { Ok(None) }
    #[tauri::command]
    pub fn scan_installed_apps() -> Vec<serde_json::Value> { vec![] }
    #[tauri::command]
    pub fn get_associated_apps(_ext: &str) -> Vec<serde_json::Value> { vec![] }
}
