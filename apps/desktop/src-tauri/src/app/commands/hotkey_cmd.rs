use crate::app_state::SettingsState;
use crate::error::{AppError, AppResult};
use crate::global_state::HOTKEY_STRING;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

fn register_shortcut(app_handle: &AppHandle, hotkey: &str) -> AppResult<()> {
    if hotkey.is_empty()
        || hotkey.eq_ignore_ascii_case("MouseMiddle")
        || hotkey.eq_ignore_ascii_case("MButton")
    {
        return Ok(());
    }

    let normalized = hotkey.replace("Win", "Super");
    let shortcut = normalized.parse::<Shortcut>().map_err(|_|AppError::Validation("快捷键格式无效".into()))?;
    app_handle.global_shortcut().register(shortcut).map_err(|_|AppError::Internal(format!("快捷键 {} 注册失败，请检查是否被其他程序占用",hotkey)))
}

pub(crate) fn sync_registered_hotkeys(app_handle: &AppHandle) -> AppResult<()> {
    let _ = app_handle.global_shortcut().unregister_all();

    let Some(settings) = app_handle.try_state::<SettingsState>() else {
        return Ok(());
    };

    let main_hotkey = settings.main_hotkey.lock().unwrap().clone();
    register_shortcut(app_handle, &main_hotkey)?;

    let sequential_mode = settings.sequential_mode.load(Ordering::Relaxed);
    let sequential_hotkey = settings.sequential_paste_hotkey.lock().unwrap().clone();
    if sequential_mode {
        let _ = register_shortcut(app_handle, &sequential_hotkey);
    }

    let rich_hotkey = settings.rich_paste_hotkey.lock().unwrap().clone();
    let _ = register_shortcut(app_handle, &rich_hotkey);

    let search_hotkey = settings.search_hotkey.lock().unwrap().clone();
    let _ = register_shortcut(app_handle, &search_hotkey);

    Ok(())
}

#[tauri::command]
pub fn register_hotkey(app_handle: AppHandle, hotkey: String) -> AppResult<()> {
    {
        let mut guard = HOTKEY_STRING.lock().unwrap();
        *guard = hotkey.clone();
    }

    if let Some(settings) = app_handle.try_state::<SettingsState>() {
        let mut guard = settings.main_hotkey.lock().unwrap();
        *guard = hotkey.clone();
    }

    sync_registered_hotkeys(&app_handle)
}

#[tauri::command]
pub fn test_hotkey_available(app_handle: AppHandle, hotkey: String) -> AppResult<bool> {
    if hotkey.is_empty()
        || hotkey.eq_ignore_ascii_case("MouseMiddle")
        || hotkey.eq_ignore_ascii_case("MButton")
    {
        return Ok(true);
    }

    let normalized = hotkey.replace("Win", "Super");
    let shortcut = normalized
        .parse::<Shortcut>()
        .map_err(|_| AppError::Validation("快捷键格式无效".to_string()))?;

    // Testing our own active binding must not unregister it or report a conflict.
    if app_handle.global_shortcut().is_registered(shortcut.clone()) {
        return Ok(true);
    }

    match app_handle.global_shortcut().register(shortcut.clone()) {
        Ok(_) => {
            let _ = app_handle.global_shortcut().unregister(shortcut);
            Ok(true)
        }
        Err(e) => {
            let err_str = format!("{:?}", e);
            let user_msg = if err_str.contains("AlreadyRegistered") {
                "该快捷键已被其他程序占用".to_string()
            } else {
                "快捷键不可用".to_string()
            };
            Err(AppError::Internal(user_msg))
        }
    }
}
