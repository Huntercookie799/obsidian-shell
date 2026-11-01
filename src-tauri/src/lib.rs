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
    }
    let _ = window.emit("island-state-changed", state);
    Ok(())
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
    let state = *state_holder.0.lock();
    update_island_geometry(&window, state)
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
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
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
                let _ = window.set_shadow(false);
                // Initialize window at collapsed notch geometry (260x34 pinned top center)
                let _ = update_island_geometry(&window, IslandState::Collapsed);
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
                            let pty_manager = app.state::<PtyManager>();
                            pty_manager.kill_all();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
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
            set_island_state,
            get_island_state,
            switch_to_next_monitor,
            center_island,
            get_system_metrics
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
