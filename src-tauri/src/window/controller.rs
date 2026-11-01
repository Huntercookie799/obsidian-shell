use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::{Emitter, PhysicalPosition, PhysicalSize, WebviewWindow};

static CURRENT_MONITOR_INDEX: AtomicUsize = AtomicUsize::new(0);
pub static SHOW_OVER_FULLSCREEN: AtomicBool = AtomicBool::new(false);

pub fn is_show_over_fullscreen() -> bool {
    SHOW_OVER_FULLSCREEN.load(Ordering::SeqCst)
}

pub fn set_show_over_fullscreen_state(enabled: bool) {
    SHOW_OVER_FULLSCREEN.store(enabled, Ordering::SeqCst);
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
    pub is_current: bool,
}

pub fn get_available_monitors_list(window: &WebviewWindow) -> Result<Vec<MonitorInfo>, String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("Error al obtener monitores disponibles: {}", e))?;

    if monitors.is_empty() {
        return Ok(Vec::new());
    }

    let primary_opt = window.primary_monitor().ok().flatten();
    let current_idx = CURRENT_MONITOR_INDEX.load(Ordering::SeqCst) % monitors.len();

    let list = monitors
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            let size = m.size();
            let pos = m.position();
            let is_primary = if let Some(ref p) = primary_opt {
                p.position() == pos && p.size() == size
            } else {
                pos.x == 0 && pos.y == 0
            };
            let is_current = idx == current_idx;
            let raw_name = m.name().map(|s| s.to_string()).unwrap_or_default();
            let display_name = if raw_name.is_empty() {
                format!("Pantalla {}", idx + 1)
            } else {
                raw_name
            };

            MonitorInfo {
                index: idx,
                name: display_name,
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
                is_primary,
                is_current,
            }
        })
        .collect();

    Ok(list)
}

pub fn set_active_monitor_by_index(
    window: &WebviewWindow,
    state: IslandState,
    monitor_idx: usize,
) -> Result<usize, String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("Error al obtener monitores disponibles: {}", e))?;

    if monitors.is_empty() {
        return Err("No hay monitores disponibles".to_string());
    }

    let target_idx = monitor_idx % monitors.len();
    update_island_geometry_on_monitor(window, state, Some(target_idx))?;
    let _ = window.emit("monitor-changed", target_idx);
    Ok(target_idx)
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
    let _ = window.emit("monitor-changed", next);
    Ok(next)
}

#[cfg(target_os = "windows")]
pub fn is_foreground_window_fullscreen(window: &WebviewWindow) -> bool {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowRect,
        GetWindowThreadProcessId, IsWindowVisible,
    };

    let fg_hwnd = unsafe { GetForegroundWindow() };
    if fg_hwnd.is_null() {
        return false;
    }

    if unsafe { IsWindowVisible(fg_hwnd) } == 0 {
        return false;
    }

    // Ignore our own window
    let our_hwnd = match window.hwnd() {
        Ok(h) => h.0 as HWND,
        Err(_) => return false,
    };
    if fg_hwnd == our_hwnd {
        return false;
    }

    // Ignore our own process
    let mut fg_pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(fg_hwnd, &mut fg_pid) };
    let our_pid = unsafe { GetCurrentProcessId() };
    if fg_pid == 0 || fg_pid == our_pid {
        return false;
    }

    // Ignore desktop and system shell windows
    let desktop_hwnd = unsafe { GetDesktopWindow() };
    if fg_hwnd == desktop_hwnd {
        return false;
    }

    let shell_hwnd = unsafe { GetShellWindow() };
    if fg_hwnd == shell_hwnd {
        return false;
    }

    let mut class_name = [0u16; 256];
    let len = unsafe { GetClassNameW(fg_hwnd, class_name.as_mut_ptr(), class_name.len() as i32) };
    if len > 0 {
        let class_str = String::from_utf16_lossy(&class_name[..len as usize]);
        if class_str == "Progman" || class_str == "WorkerW" || class_str == "Shell_TrayWnd" {
            return false;
        }
    }

    // Check monitors: both must be on the same monitor
    let fg_monitor = unsafe { MonitorFromWindow(fg_hwnd, MONITOR_DEFAULTTONEAREST) };
    let our_monitor = unsafe { MonitorFromWindow(our_hwnd, MONITOR_DEFAULTTONEAREST) };
    if fg_monitor.is_null() || fg_monitor != our_monitor {
        return false;
    }

    // Check window rectangle vs monitor full rectangle
    let mut fg_rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(fg_hwnd, &mut fg_rect) } == 0 {
        return false;
    }

    let mut mi = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        rcWork: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        dwFlags: 0,
    };
    if unsafe { GetMonitorInfoW(fg_monitor, &mut mi) } == 0 {
        return false;
    }

    // A window is considered fullscreen if it covers the entire monitor rect
    fg_rect.left <= mi.rcMonitor.left
        && fg_rect.top <= mi.rcMonitor.top
        && fg_rect.right >= mi.rcMonitor.right
        && fg_rect.bottom >= mi.rcMonitor.bottom
}

#[cfg(not(target_os = "windows"))]
pub fn is_foreground_window_fullscreen(_window: &WebviewWindow) -> bool {
    false
}

pub fn handle_fullscreen_visibility(
    window: &WebviewWindow,
    current_state: IslandState,
) -> Result<bool, String> {
    let is_fullscreen = is_foreground_window_fullscreen(window);
    let show_over = is_show_over_fullscreen();

    if show_over {
        // En modo "Mostrar sobre pantalla completa", garantizar que esté visible y en el tope
        let _ = window.show();
        let _ = window.set_always_on_top(true);
    } else {
        // En modo "Ocultar sobre pantalla completa"
        if is_fullscreen {
            if current_state == IslandState::Collapsed || current_state == IslandState::Glance {
                let _ = window.hide();
            }
        } else {
            // No hay app en pantalla completa en este monitor: restaurar visibilidad
            let is_visible = window.is_visible().unwrap_or(false);
            if !is_visible {
                let _ = window.show();
                let _ = window.set_always_on_top(true);
            }
        }
    }

    Ok(is_fullscreen)
}
