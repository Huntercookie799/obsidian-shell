use tauri::{AppHandle, State};
use crate::pty::PtyManager;

#[tauri::command]
pub fn create_pty_session(
    app: AppHandle,
    manager: State<PtyManager>,
    shell_path: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    manager.create_session(&app, shell_path, cwd, cols, rows)
}

#[tauri::command]
pub fn write_to_pty(
    manager: State<PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager.write_to_pty(&session_id, &data)
}

#[tauri::command]
pub fn resize_pty(
    manager: State<PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize_pty(&session_id, cols, rows)
}

#[tauri::command]
pub fn kill_pty_session(
    manager: State<PtyManager>,
    session_id: String,
) -> Result<(), String> {
    manager.kill_pty_session(&session_id)
}

#[tauri::command]
pub fn get_session_cwd(
    manager: State<PtyManager>,
    session_id: String,
) -> Option<String> {
    manager.get_session_cwd(&session_id)
}
