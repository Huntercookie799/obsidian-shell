pub mod commands;
pub mod pty;
pub mod state;
pub mod window;

use std::sync::Arc;
use parking_lot::Mutex;
use pty::PtyManager;
use sysinfo::System;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use window::{switch_monitor, update_island_geometry, IslandState};

pub use commands::*;
pub use state::*;

pub fn next_island_state(current: IslandState) -> IslandState {
    match current {
        IslandState::Collapsed | IslandState::Glance => IslandState::Expanded,
        IslandState::Expanded | IslandState::Fullscreen => IslandState::Collapsed,
    }
}

fn toggle_island_window(app: &tauri::AppHandle) {
    window::set_idle_hidden_state(false);
    let state_holder = app.state::<IslandStateHolder>();
    let mut current = state_holder.0.lock();
    let next = next_island_state(*current);
    *current = next;
    drop(current);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(true);
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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_island_window(app);
                    }
                })
                .build(),
        )
        .manage(pty_manager)
        .manage(state_holder)
        .manage(system_metrics_holder)
        .setup(|app| {
            let is_autostart = std::env::args().any(|arg| arg == "--autostart");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(false);
                let _ = window.set_skip_taskbar(true);
                let _ = update_island_geometry(&window, IslandState::Collapsed);

                let startup_window = window.clone();
                std::thread::spawn(move || {
                    let delays = if is_autostart { [1500_u64, 3500_u64] } else { [800_u64, 2000_u64] };
                    for delay in delays {
                        std::thread::sleep(std::time::Duration::from_millis(delay));
                        let _ = startup_window.set_skip_taskbar(true);
                        if !window::is_idle_hidden() {
                            let _ = update_island_geometry(&startup_window, IslandState::Collapsed);
                            let _ = startup_window.show();
                            let _ = startup_window.set_always_on_top(true);
                        }
                    }
                });

                let window_clone = window.clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(200));
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

            let shortcut_manager = app.global_shortcut();
            if let Err(e) = shortcut_manager.register("Alt+Space") {
                eprintln!("[ObsidianShell] No se pudo registrar 'Alt+Space': {}", e);
            }
            if let Err(e) = shortcut_manager.register("CommandOrControl+Backquote") {
                eprintln!("[ObsidianShell] No se pudo registrar 'CommandOrControl+Backquote': {}", e);
            }

            let toggle_item = MenuItem::with_id(app, "toggle", "Mostrar / Ocultar ObsidianShell (Alt+Space)", true, None::<&str>)?;
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
                            toggle_island_window(app);
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
                        toggle_island_window(tray.app_handle());
                    }
                });

            let tray_result = if let Some(icon) = app.default_window_icon() {
                tray_builder.icon(icon.clone()).build(app)
            } else {
                tray_builder.build(app)
            };
            if let Err(e) = tray_result {
                eprintln!("[ObsidianShell] No se pudo crear el icono en la bandeja: {}", e);
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
        .expect("error al ejecutar la aplicación tauri")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                pty_manager_cleanup.kill_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alterna_colapsado_a_expandido() {
        assert_eq!(next_island_state(IslandState::Collapsed), IslandState::Expanded);
    }

    #[test]
    fn alterna_vistazo_a_expandido() {
        assert_eq!(next_island_state(IslandState::Glance), IslandState::Expanded);
    }

    #[test]
    fn alterna_expandido_a_colapsado() {
        assert_eq!(next_island_state(IslandState::Expanded), IslandState::Collapsed);
    }

    #[test]
    fn alterna_pantalla_completa_a_colapsado() {
        assert_eq!(next_island_state(IslandState::Fullscreen), IslandState::Collapsed);
    }
}
