use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn save_session_snapshot(app: AppHandle, payload: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    let target_file = data_dir.join("session-snapshot.json");
    let tmp_file = data_dir.join("session-snapshot.json.tmp");
    std::fs::write(&tmp_file, payload.as_bytes()).map_err(|e| format!("Failed to write tmp snapshot: {}", e))?;
    std::fs::rename(&tmp_file, &target_file).map_err(|e| format!("Failed to persist snapshot atomically: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_session_snapshot(app: AppHandle) -> Result<Option<String>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_file = data_dir.join("session-snapshot.json");
    if !target_file.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&target_file).map_err(|e| format!("Failed to read snapshot: {}", e))?;
    if content.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(content))
}

#[tauri::command]
pub fn clear_session_snapshot(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_file = data_dir.join("session-snapshot.json");
    if target_file.exists() {
        let _ = std::fs::remove_file(&target_file);
    }
    let tmp_file = data_dir.join("session-snapshot.json.tmp");
    if tmp_file.exists() {
        let _ = std::fs::remove_file(&tmp_file);
    }
    Ok(())
}
