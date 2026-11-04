pub mod pty;
pub mod window;

use std::sync::Arc;
use parking_lot::Mutex;
use pty::PtyManager;
use sysinfo::System;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use window::{switch_monitor, update_island_geometry, IslandState};

#[derive(Clone, Default)]
pub struct IslandStateHolder(pub Arc<Mutex<IslandState>>);

pub struct SystemMetricsHolder(pub Arc<Mutex<System>>);

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemMetrics {
    pub cpu_usage: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_percent: f32,
}

#[tauri::command]
fn get_system_metrics(system_holder: State<SystemMetricsHolder>) -> SystemMetrics {
    let mut sys = system_holder.0.lock();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_usage = sys.global_cpu_usage();
    let total_mem = sys.total_memory() / (1024 * 1024);
    let used_mem = sys.used_memory() / (1024 * 1024);
    let mem_percent = if total_mem > 0 {
        (used_mem as f32 / total_mem as f32) * 100.0
    } else {
        0.0
    };

    SystemMetrics {
        cpu_usage,
        memory_used_mb: used_mem,
        memory_total_mb: total_mem,
        memory_percent: mem_percent,
    }
}

#[tauri::command]
fn create_pty_session(
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
fn write_to_pty(
    manager: State<PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager.write_to_pty(&session_id, &data)
}

#[tauri::command]
fn resize_pty(
    manager: State<PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize_pty(&session_id, cols, rows)
}

#[tauri::command]
fn kill_pty_session(
    manager: State<PtyManager>,
    session_id: String,
) -> Result<(), String> {
    manager.kill_pty_session(&session_id)
}

#[tauri::command]
fn get_session_cwd(
    manager: State<PtyManager>,
    session_id: String,
) -> Option<String> {
    manager.get_session_cwd(&session_id)
}

#[tauri::command]
fn save_session_snapshot(app: AppHandle, payload: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    let target_file = data_dir.join("session-snapshot.json");
    let tmp_file = data_dir.join("session-snapshot.json.tmp");
    std::fs::write(&tmp_file, payload.as_bytes()).map_err(|e| format!("Failed to write tmp snapshot: {}", e))?;
    std::fs::rename(&tmp_file, &target_file).map_err(|e| format!("Failed to persist snapshot atomically: {}", e))?;
    Ok(())
}

#[tauri::command]
fn load_session_snapshot(app: AppHandle) -> Result<Option<String>, String> {
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
fn clear_session_snapshot(app: AppHandle) -> Result<(), String> {
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

#[tauri::command]
fn quit_app_immediately(app: AppHandle, pty_manager: State<PtyManager>) {
    pty_manager.kill_all();
    app.exit(0);
}

#[tauri::command]
fn set_island_state(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
    state: IslandState,
) -> Result<(), String> {
    *state_holder.0.lock() = state;
    update_island_geometry(&window, state)?;
    if state == IslandState::Expanded {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window::handle_fullscreen_visibility(&window, state);
    }
    let _ = window.emit("island-state-changed", state);
    Ok(())
}

#[tauri::command]
fn set_show_over_fullscreen(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
    enabled: bool,
) -> Result<(), String> {
    window::set_show_over_fullscreen_state(enabled);
    let state = *state_holder.0.lock();
    window::handle_fullscreen_visibility(&window, state)?;
    Ok(())
}

#[tauri::command]
fn check_fullscreen_occlusion(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<bool, String> {
    let state = *state_holder.0.lock();
    window::handle_fullscreen_visibility(&window, state)
}

#[tauri::command]
fn get_island_state(state_holder: State<IslandStateHolder>) -> IslandState {
    *state_holder.0.lock()
}

#[tauri::command]
fn switch_to_next_monitor(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<usize, String> {
    let state = *state_holder.0.lock();
    switch_monitor(&window, state)
}

#[tauri::command]
fn center_island(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<(), String> {
    window::set_dock_position(window::DockPosition::TopCenter);
    let state = *state_holder.0.lock();
    window::update_island_geometry(&window, state)?;
    let _ = window.emit("dock-position-changed", &window::DockPosition::TopCenter);
    Ok(())
}

#[tauri::command]
fn set_dock_position(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
    position: window::DockPosition,
) -> Result<(), String> {
    window::set_dock_position(position);
    let state = *state_holder.0.lock();
    window::update_island_geometry(&window, state)?;
    let _ = window.emit("dock-position-changed", &position);
    Ok(())
}

#[tauri::command]
fn get_dock_position() -> window::DockPosition {
    window::get_dock_position()
}

#[tauri::command]
fn snap_window_to_nearest_edge(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<window::DockPosition, String> {
    let state = *state_holder.0.lock();
    window::snap_window_to_nearest_edge(&window, state)
}

#[tauri::command]
fn get_available_monitors(window: WebviewWindow) -> Result<Vec<window::MonitorInfo>, String> {
    window::get_available_monitors_list(&window)
}

#[tauri::command]
fn set_active_monitor(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
    monitor_index: usize,
) -> Result<usize, String> {
    let state = *state_holder.0.lock();
    window::set_active_monitor_by_index(&window, state, monitor_index)
}

#[tauri::command]
fn set_expanded_dimensions(
    window: WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let safe_w = width.clamp(600.0, 1400.0);
    let safe_h = height.clamp(250.0, 800.0);
    window::set_expanded_dimensions_internal(safe_w, safe_h);

    let _ = window.set_resizable(true);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(safe_w, safe_h)));
    let _ = window.set_resizable(false);

    // Ajustar posición para mantener el centrado o anclaje según el DockPosition
    let _ = window::update_island_geometry(&window, window::IslandState::Expanded);

    Ok(())
}

#[tauri::command]
fn set_idle_hidden(window: WebviewWindow, hidden: bool) -> Result<(), String> {
    window::set_idle_hidden_state(hidden);
    if hidden {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_always_on_top(true);
        let _ = window::update_island_geometry(&window, window::IslandState::Collapsed);
        let _ = window.emit("edge-hover-wakeup", ());
    }
    Ok(())
}

#[tauri::command]
fn is_idle_hidden() -> bool {
    window::is_idle_hidden()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = PtyManager::new();
    let pty_manager_cleanup = pty_manager.clone();
    let state_holder = IslandStateHolder::default();
    let system_metrics_holder = SystemMetricsHolder(Arc::new(Mutex::new(System::new_all())));

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        window::set_idle_hidden_state(false);
                        let state_holder = app.state::<IslandStateHolder>();
                        let mut current = state_holder.0.lock();
                        let next = match *current {
                            IslandState::Collapsed | IslandState::Glance => IslandState::Expanded,
                            IslandState::Expanded => IslandState::Collapsed,
                        };
                        *current = next;
                        drop(current);

                        if let Some(window) = app.get_webview_window("main") {
                            let _ = update_island_geometry(&window, next);
                            if next == IslandState::Expanded {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.set_always_on_top(true);
                            } else {
                                let _ = window::handle_fullscreen_visibility(&window, next);
                            }
                            let _ = window.emit("island-state-changed", next);
                        }
                    }
                })
                .build(),
        )
        .manage(pty_manager)
        .manage(state_holder)
        .manage(system_metrics_holder)
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Eliminate DWM rectangular shadow on Windows 11 around transparent window
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(false);
                // Initialize window at collapsed notch geometry (260x34 pinned top center)
                let _ = update_island_geometry(&window, IslandState::Collapsed);

                // Hilo de sondeo ligero para Edge Hover Wakeup (Fase 31)
                let window_clone = window.clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(80));
                        if window::is_idle_hidden() {
                            if let Some(cursor) = window::get_cursor_pos() {
                                if window::is_cursor_near_dock(&window_clone, cursor) {
                                    window::wake_up_from_idle(&window_clone);
                                }
                            }
                        }
                    }
                });
            }

            // Register global shortcuts: Alt+Space and CommandOrControl+Backquote as fallback
            let shortcut_manager = app.global_shortcut();
            if let Err(e) = shortcut_manager.register("Alt+Space") {
                eprintln!("[Vayli] Note: Could not register 'Alt+Space': {}", e);
            }
            if let Err(e) = shortcut_manager.register("CommandOrControl+Backquote") {
                eprintln!("[Vayli] Note: Could not register 'CommandOrControl+Backquote': {}", e);
            }

            // Configure Native System Tray
            let toggle_item = MenuItem::with_id(app, "toggle", "Mostrar / Ocultar Vayli (Alt+Space)", true, None::<&str>)?;
            let switch_mon_item = MenuItem::with_id(app, "switch_mon", "Cambiar de Monitor", true, None::<&str>)?;
            let center_item = MenuItem::with_id(app, "center", "Centrar Isla", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Salir completamente", true, None::<&str>)?;

            let tray_menu = Menu::with_items(app, &[
                &toggle_item,
                &switch_mon_item,
                &center_item,
                &quit_item,
            ])?;

            let tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "toggle" => {
                            window::set_idle_hidden_state(false);
                            let state_holder = app.state::<IslandStateHolder>();
                            let mut current = state_holder.0.lock();
                            let next = match *current {
                                IslandState::Collapsed | IslandState::Glance => IslandState::Expanded,
                                IslandState::Expanded => IslandState::Collapsed,
                            };
                            *current = next;
                            drop(current);

                            if let Some(window) = app.get_webview_window("main") {
                                let _ = update_island_geometry(&window, next);
                                if next == IslandState::Expanded {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    let _ = window.set_always_on_top(true);
                                } else {
                                    let _ = window::handle_fullscreen_visibility(&window, next);
                                }
                                let _ = window.emit("island-state-changed", next);
                            }
                        }
                        "switch_mon" => {
                            let state_holder = app.state::<IslandStateHolder>();
                            let current = *state_holder.0.lock();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = switch_monitor(&window, current);
                            }
                        }
                        "center" => {
                            let state_holder = app.state::<IslandStateHolder>();
                            let current = *state_holder.0.lock();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = update_island_geometry(&window, current);
                            }
                        }
                        "quit" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray-quit-requested", ());
                                let app_clone = app.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(std::time::Duration::from_millis(1200));
                                    let pty_manager = app_clone.state::<PtyManager>();
                                    pty_manager.kill_all();
                                    app_clone.exit(0);
                                });
                            } else {
                                let pty_manager = app.state::<PtyManager>();
                                pty_manager.kill_all();
                                app.exit(0);
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        window::set_idle_hidden_state(false);
                        let app = tray.app_handle();
                        let state_holder = app.state::<IslandStateHolder>();
                        let mut current = state_holder.0.lock();
                        let next = match *current {
                            IslandState::Collapsed | IslandState::Glance => IslandState::Expanded,
                            IslandState::Expanded => IslandState::Collapsed,
                        };
                        *current = next;
                        drop(current);

                        if let Some(window) = app.get_webview_window("main") {
                            let _ = update_island_geometry(&window, next);
                            if next == IslandState::Expanded {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.set_always_on_top(true);
                            } else {
                                let _ = window::handle_fullscreen_visibility(&window, next);
                            }
                            let _ = window.emit("island-state-changed", next);
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                let _ = tray_builder.icon(icon.clone()).build(app)?;
            } else {
                let _ = tray_builder.build(app)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_pty_session,
            write_to_pty,
            resize_pty,
            kill_pty_session,
            get_session_cwd,
            save_session_snapshot,
            load_session_snapshot,
            clear_session_snapshot,
            quit_app_immediately,
            set_island_state,
            get_island_state,
            set_show_over_fullscreen,
            check_fullscreen_occlusion,
            switch_to_next_monitor,
            center_island,
            set_dock_position,
            get_dock_position,
            snap_window_to_nearest_edge,
            get_system_metrics,
            get_available_monitors,
            set_active_monitor,
            set_expanded_dimensions,
            set_idle_hidden,
            is_idle_hidden
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Clean up all background child processes
                pty_manager_cleanup.kill_all();
            }
        });
}
