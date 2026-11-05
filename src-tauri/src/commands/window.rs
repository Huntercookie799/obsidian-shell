use tauri::{Emitter, State, WebviewWindow};
use crate::state::IslandStateHolder;
use crate::window::{self, switch_monitor, update_island_geometry, DockPosition, IslandState, MonitorInfo};

#[tauri::command]
pub fn set_island_state(
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
pub fn set_show_over_fullscreen(
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
pub fn check_fullscreen_occlusion(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<bool, String> {
    let state = *state_holder.0.lock();
    window::handle_fullscreen_visibility(&window, state)
}

#[tauri::command]
pub fn get_island_state(state_holder: State<IslandStateHolder>) -> IslandState {
    *state_holder.0.lock()
}

#[tauri::command]
pub fn switch_to_next_monitor(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<usize, String> {
    let state = *state_holder.0.lock();
    switch_monitor(&window, state)
}

#[tauri::command]
pub fn center_island(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<(), String> {
    window::set_dock_position(DockPosition::TopCenter);
    let state = *state_holder.0.lock();
    window::update_island_geometry(&window, state)?;
    let _ = window.emit("dock-position-changed", &DockPosition::TopCenter);
    Ok(())
}

#[tauri::command]
pub fn set_dock_position(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
    position: DockPosition,
) -> Result<(), String> {
    window::set_dock_position(position);
    let state = *state_holder.0.lock();
    window::update_island_geometry(&window, state)?;
    let _ = window.emit("dock-position-changed", &position);
    Ok(())
}

#[tauri::command]
pub fn get_dock_position() -> DockPosition {
    window::get_dock_position()
}

#[tauri::command]
pub fn snap_window_to_nearest_edge(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
) -> Result<DockPosition, String> {
    let state = *state_holder.0.lock();
    window::snap_window_to_nearest_edge(&window, state)
}

#[tauri::command]
pub fn get_available_monitors(window: WebviewWindow) -> Result<Vec<MonitorInfo>, String> {
    window::get_available_monitors_list(&window)
}

#[tauri::command]
pub fn set_active_monitor(
    window: WebviewWindow,
    state_holder: State<IslandStateHolder>,
    monitor_index: usize,
) -> Result<usize, String> {
    let state = *state_holder.0.lock();
    window::set_active_monitor_by_index(&window, state, monitor_index)
}

#[tauri::command]
pub fn set_expanded_dimensions(
    window: WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let safe_w = width.clamp(400.0, 2400.0);
    let safe_h = height.clamp(200.0, 1200.0);
    window::set_expanded_dimensions_internal(safe_w, safe_h);

    let _ = window.set_resizable(true);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(safe_w, safe_h)));
    let _ = window.set_resizable(false);

    // Ajustar posición para mantener el centrado o anclaje según el DockPosition
    let _ = window::update_island_geometry(&window, IslandState::Expanded);

    Ok(())
}

#[tauri::command]
pub fn set_idle_hidden(window: WebviewWindow, hidden: bool) -> Result<(), String> {
    window::set_idle_hidden_state(hidden);
    if hidden {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_always_on_top(true);
        let _ = window::update_island_geometry(&window, IslandState::Collapsed);
        let _ = window.emit("edge-hover-wakeup", ());
    }
    Ok(())
}

#[tauri::command]
pub fn is_idle_hidden() -> bool {
    window::is_idle_hidden()
}
