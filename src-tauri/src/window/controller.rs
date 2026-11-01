use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

static CURRENT_MONITOR_INDEX: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandState {
    #[default]
    Collapsed,
    Glance,
    Expanded,
}

pub fn update_island_geometry_on_monitor(
    window: &WebviewWindow,
    state: IslandState,
    monitor_idx: Option<usize>,
) -> Result<(), String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("Failed to get available monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitor found for current window".to_string());
    }

    let idx = monitor_idx.unwrap_or_else(|| CURRENT_MONITOR_INDEX.load(Ordering::SeqCst)) % monitors.len();
    CURRENT_MONITOR_INDEX.store(idx, Ordering::SeqCst);

    let monitor = &monitors[idx];
    let scale_factor = monitor.scale_factor();
    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();

    let (logical_w, logical_h) = match state {
        IslandState::Collapsed => (260.0, 34.0),
        IslandState::Glance => (420.0, 64.0),
        IslandState::Expanded => (850.0, 480.0),
    };

    let phys_w = (logical_w * scale_factor).round() as u32;
    let phys_h = (logical_h * scale_factor).round() as u32;

    let center_offset = (monitor_size.width.saturating_sub(phys_w)) / 2;
    let phys_x = monitor_pos.x + center_offset as i32;
    let phys_y = monitor_pos.y; // Pinned directly to the top edge (y = 0)

    // Temporarily allow resize during programmatic HUD state transition on Windows
    let _ = window.set_resizable(true);

    window
        .set_size(PhysicalSize::new(phys_w, phys_h))
        .map_err(|e| format!("Failed to set window size: {}", e))?;

    window
        .set_position(PhysicalPosition::new(phys_x, phys_y))
        .map_err(|e| format!("Failed to set window position: {}", e))?;

    // Lock manual edge-dragging by user
    let _ = window.set_resizable(false);

    Ok(())
}

pub fn update_island_geometry(window: &WebviewWindow, state: IslandState) -> Result<(), String> {
    update_island_geometry_on_monitor(window, state, None)
}

pub fn switch_monitor(window: &WebviewWindow, state: IslandState) -> Result<usize, String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("Failed to get available monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors available".to_string());
    }

    let current = CURRENT_MONITOR_INDEX.load(Ordering::SeqCst);
    let next = (current + 1) % monitors.len();
    update_island_geometry_on_monitor(window, state, Some(next))?;
    Ok(next)
}
