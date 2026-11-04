use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::{Emitter, PhysicalPosition, PhysicalSize, WebviewWindow};

static CURRENT_MONITOR_INDEX: AtomicUsize = AtomicUsize::new(0);
pub static SHOW_OVER_FULLSCREEN: AtomicBool = AtomicBool::new(false);
pub static IDLE_HIDDEN: AtomicBool = AtomicBool::new(false);

pub fn is_idle_hidden() -> bool {
    IDLE_HIDDEN.load(Ordering::SeqCst)
}

pub fn set_idle_hidden_state(hidden: bool) {
    IDLE_HIDDEN.store(hidden, Ordering::SeqCst);
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DockPosition {
    TopCenter,
    TopLeft,
    TopRight,
    LeftEdge { y_ratio: f32 },
    RightEdge { y_ratio: f32 },
}

impl Default for DockPosition {
    fn default() -> Self {
        DockPosition::TopCenter
    }
}

static CURRENT_DOCK_POSITION: Mutex<DockPosition> = Mutex::new(DockPosition::TopCenter);

pub fn get_dock_position() -> DockPosition {
    *CURRENT_DOCK_POSITION.lock()
}

pub fn set_dock_position(pos: DockPosition) {
    *CURRENT_DOCK_POSITION.lock() = pos;
}

#[derive(Debug, Clone, Copy)]
pub struct ExpandedDimensions {
    pub width: f64,
    pub height: f64,
}

static EXPANDED_DIMENSIONS: Mutex<ExpandedDimensions> = Mutex::new(ExpandedDimensions {
    width: 850.0,
    height: 360.0,
});

pub fn get_expanded_dimensions() -> (f64, f64) {
    let dims = *EXPANDED_DIMENSIONS.lock();
    (dims.width, dims.height)
}

pub fn set_expanded_dimensions_internal(width: f64, height: f64) {
    let mut dims = EXPANDED_DIMENSIONS.lock();
    dims.width = width.clamp(600.0, 1400.0);
    dims.height = height.clamp(250.0, 800.0);
}

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

    let dock_pos = get_dock_position();

    let (phys_w, phys_h, phys_x, phys_y) = match dock_pos {
        DockPosition::TopCenter | DockPosition::TopLeft | DockPosition::TopRight => {
            let (exp_w, exp_h) = get_expanded_dimensions();
            let (logical_w, logical_h) = match state {
                IslandState::Collapsed => (260.0, 34.0),
                IslandState::Glance => (420.0, 64.0),
                IslandState::Expanded => (exp_w, exp_h),
            };

            let pw = (logical_w * scale_factor).round() as u32;
            let ph = (logical_h * scale_factor).round() as u32;

            let px = match dock_pos {
                DockPosition::TopCenter => {
                    let center_offset = (monitor_size.width.saturating_sub(pw)) / 2;
                    monitor_pos.x + center_offset as i32
                }
                DockPosition::TopLeft => {
                    monitor_pos.x + (16.0 * scale_factor).round() as i32
                }
                DockPosition::TopRight => {
                    monitor_pos.x + monitor_size.width as i32 - pw as i32 - (16.0 * scale_factor).round() as i32
                }
                _ => unreachable!(),
            };
            let py = monitor_pos.y;
            (pw, ph, px, py)
        }
        DockPosition::LeftEdge { y_ratio } => {
            let safe_ratio = y_ratio.clamp(0.0, 1.0);
            if state == IslandState::Collapsed {
                // Modo Pestaña Vertical: 34x260
                let pw = (34.0 * scale_factor).round() as u32;
                let ph = (260.0 * scale_factor).round() as u32;
                let px = monitor_pos.x + (4.0 * scale_factor).round() as i32;
                let available_h = monitor_size.height.saturating_sub(ph) as f32;
                let py = monitor_pos.y + (available_h * safe_ratio).round() as i32;
                (pw, ph, px, py)
            } else if state == IslandState::Glance {
                // Modo Glance Lateral: 420x260 desplegándose hacia la derecha.
                // Mantiene exactamente la misma altura (260px) y coordenada Y de Collapsed para evitar saltos o pérdida del cursor
                let pw = (420.0 * scale_factor).round() as u32;
                let ph = (260.0 * scale_factor).round() as u32;
                let px = monitor_pos.x + (4.0 * scale_factor).round() as i32;
                let available_h = monitor_size.height.saturating_sub(ph) as f32;
                let py = monitor_pos.y + (available_h * safe_ratio).round() as i32;
                (pw, ph, px, py)
            } else {
                // Expanded (redimensionable) desplegándose hacia la derecha, centrado verticalmente con la píldora
                let (exp_w, exp_h) = get_expanded_dimensions();
                let pw = (exp_w * scale_factor).round() as u32;
                let ph = (exp_h * scale_factor).round() as u32;
                let px = monitor_pos.x + (4.0 * scale_factor).round() as i32;

                let pill_h = (260.0 * scale_factor).round() as f32;
                let available_h_pill = monitor_size.height.saturating_sub(pill_h as u32) as f32;
                let pill_top_y = monitor_pos.y as f32 + (available_h_pill * safe_ratio);
                let pill_center_y = pill_top_y + (pill_h / 2.0);

                let ideal_y = (pill_center_y - (ph as f32 / 2.0)).round() as i32;
                let min_y = monitor_pos.y + (8.0 * scale_factor).round() as i32;
                let max_y = monitor_pos.y + monitor_size.height as i32 - ph as i32 - (8.0 * scale_factor).round() as i32;
                let py = ideal_y.clamp(min_y, max_y.max(min_y));
                (pw, ph, px, py)
            }
        }
        DockPosition::RightEdge { y_ratio } => {
            let safe_ratio = y_ratio.clamp(0.0, 1.0);
            if state == IslandState::Collapsed {
                // Modo Pestaña Vertical: 34x260
                let pw = (34.0 * scale_factor).round() as u32;
                let ph = (260.0 * scale_factor).round() as u32;
                let px = monitor_pos.x + monitor_size.width as i32 - pw as i32 - (4.0 * scale_factor).round() as i32;
                let available_h = monitor_size.height.saturating_sub(ph) as f32;
                let py = monitor_pos.y + (available_h * safe_ratio).round() as i32;
                (pw, ph, px, py)
            } else if state == IslandState::Glance {
                // Modo Glance Lateral: 420x260 desplegándose hacia la izquierda.
                // Mantiene exactamente la misma altura (260px) y coordenada Y de Collapsed para evitar saltos o pérdida del cursor
                let pw = (420.0 * scale_factor).round() as u32;
                let ph = (260.0 * scale_factor).round() as u32;
                let px = monitor_pos.x + monitor_size.width as i32 - pw as i32 - (4.0 * scale_factor).round() as i32;
                let available_h = monitor_size.height.saturating_sub(ph) as f32;
                let py = monitor_pos.y + (available_h * safe_ratio).round() as i32;
                (pw, ph, px, py)
            } else {
                // Expanded (redimensionable) desplegándose hacia la izquierda, centrado verticalmente con la píldora
                let (exp_w, exp_h) = get_expanded_dimensions();
                let pw = (exp_w * scale_factor).round() as u32;
                let ph = (exp_h * scale_factor).round() as u32;
                let px = monitor_pos.x + monitor_size.width as i32 - pw as i32 - (4.0 * scale_factor).round() as i32;

                let pill_h = (260.0 * scale_factor).round() as f32;
                let available_h_pill = monitor_size.height.saturating_sub(pill_h as u32) as f32;
                let pill_top_y = monitor_pos.y as f32 + (available_h_pill * safe_ratio);
                let pill_center_y = pill_top_y + (pill_h / 2.0);

                let ideal_y = (pill_center_y - (ph as f32 / 2.0)).round() as i32;
                let min_y = monitor_pos.y + (8.0 * scale_factor).round() as i32;
                let max_y = monitor_pos.y + monitor_size.height as i32 - ph as i32 - (8.0 * scale_factor).round() as i32;
                let py = ideal_y.clamp(min_y, max_y.max(min_y));
                (pw, ph, px, py)
            }
        }
    };

    // Temporarily allow resize during programmatic HUD state transition on Windows
    let _ = window.set_resizable(true);

    window
        .set_size(PhysicalSize::new(phys_w, phys_h))
        .map_err(|e| format!("Failed to set window size: {}", e))?;

    window
        .set_position(PhysicalPosition::new(phys_x, phys_y))
        .map_err(|e| format!("Failed to set window position: {}", e))?;

    // Lock manual edge-dragging by user and prevent rectangular DWM window shadow
    let _ = window.set_resizable(false);
    let _ = window.set_shadow(false);

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

pub fn snap_window_to_nearest_edge(
    window: &WebviewWindow,
    current_state: IslandState,
) -> Result<DockPosition, String> {
    let win_pos = window
        .outer_position()
        .map_err(|e| format!("Error al obtener posición de ventana: {}", e))?;
    let win_size = window
        .outer_size()
        .map_err(|e| format!("Error al obtener tamaño de ventana: {}", e))?;

    let monitors = window
        .available_monitors()
        .map_err(|e| format!("Error al listar monitores: {}", e))?;

    if monitors.is_empty() {
        return Err("No hay monitores disponibles".to_string());
    }

    // Identificar el monitor más cercano al centro de la ventana
    let win_center_x = win_pos.x + (win_size.width as i32 / 2);
    let win_center_y = win_pos.y + (win_size.height as i32 / 2);

    let mut best_monitor_idx = 0;
    let mut min_mon_dist = i64::MAX;

    for (idx, m) in monitors.iter().enumerate() {
        let m_pos = m.position();
        let m_size = m.size();
        let m_cx = m_pos.x + (m_size.width as i32 / 2);
        let m_cy = m_pos.y + (m_size.height as i32 / 2);
        let dist = ((win_center_x - m_cx) as i64).pow(2) + ((win_center_y - m_cy) as i64).pow(2);
        if dist < min_mon_dist {
            min_mon_dist = dist;
            best_monitor_idx = idx;
        }
    }

    CURRENT_MONITOR_INDEX.store(best_monitor_idx, Ordering::SeqCst);
    let monitor = &monitors[best_monitor_idx];
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let mon_w = mon_size.width as i32;
    let mon_h = mon_size.height as i32;

    let rel_x = (win_center_x - mon_pos.x).clamp(0, mon_w);
    let rel_y = (win_center_y - mon_pos.y).clamp(0, mon_h);

    let dist_top = rel_y;
    let dist_left = rel_x;
    let dist_right = mon_w - rel_x;

    let best_dock = if dist_left < dist_top && dist_left < dist_right {
        let y_ratio = (rel_y as f32 / mon_h.max(1) as f32).clamp(0.05, 0.95);
        DockPosition::LeftEdge { y_ratio }
    } else if dist_right < dist_top && dist_right < dist_left {
        let y_ratio = (rel_y as f32 / mon_h.max(1) as f32).clamp(0.05, 0.95);
        DockPosition::RightEdge { y_ratio }
    } else {
        let x_fraction = rel_x as f32 / mon_w.max(1) as f32;
        if x_fraction < 0.28 {
            DockPosition::TopLeft
        } else if x_fraction > 0.72 {
            DockPosition::TopRight
        } else {
            DockPosition::TopCenter
        }
    };

    set_dock_position(best_dock);
    update_island_geometry_on_monitor(window, current_state, Some(best_monitor_idx))?;
    let _ = window.emit("dock-position-changed", &best_dock);

    Ok(best_dock)
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

#[cfg(target_os = "windows")]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok != 0 {
        Some((pt.x, pt.y))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    None
}

pub fn is_cursor_near_dock(window: &WebviewWindow, (cursor_x, cursor_y): (i32, i32)) -> bool {
    let monitors = match window.available_monitors() {
        Ok(m) => m,
        Err(_) => return false,
    };
    if monitors.is_empty() {
        return false;
    }

    let idx = CURRENT_MONITOR_INDEX.load(Ordering::SeqCst) % monitors.len();
    let monitor = &monitors[idx];
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let scale = monitor.scale_factor();
    let dock_pos = get_dock_position();

    let mon_x = mon_pos.x;
    let mon_y = mon_pos.y;
    let mon_w = mon_size.width as i32;
    let mon_h = mon_size.height as i32;
    let mon_max_x = mon_x + mon_w;
    let mon_max_y = mon_y + mon_h;

    // Descartar si el cursor está fuera de los límites generales del monitor activo
    if cursor_x < mon_x - 10 || cursor_x > mon_max_x + 10 || cursor_y < mon_y - 10 || cursor_y > mon_max_y + 10 {
        return false;
    }

    let threshold = ((15.0 * scale).round() as i32).max(15);
    let pill_w = (260.0 * scale).round() as i32;
    let pill_h = (260.0 * scale).round() as i32;

    match dock_pos {
        DockPosition::TopCenter => {
            let center_x = mon_x + (mon_w / 2);
            let in_x_range = cursor_x >= (center_x - (pill_w / 2) - 30) && cursor_x <= (center_x + (pill_w / 2) + 30);
            let in_y_range = cursor_y >= mon_y && cursor_y <= (mon_y + threshold);
            in_x_range && in_y_range
        }
        DockPosition::TopLeft => {
            let in_x_range = cursor_x >= mon_x && cursor_x <= (mon_x + pill_w + 30);
            let in_y_range = cursor_y >= mon_y && cursor_y <= (mon_y + threshold);
            in_x_range && in_y_range
        }
        DockPosition::TopRight => {
            let in_x_range = cursor_x >= (mon_max_x - pill_w - 30) && cursor_x <= mon_max_x;
            let in_y_range = cursor_y >= mon_y && cursor_y <= (mon_y + threshold);
            in_x_range && in_y_range
        }
        DockPosition::LeftEdge { y_ratio } => {
            let safe_ratio = y_ratio.clamp(0.0, 1.0);
            let available_h = mon_size.height.saturating_sub(pill_h as u32) as f32;
            let pill_y = mon_y + (available_h * safe_ratio).round() as i32;
            let in_x_range = cursor_x >= mon_x && cursor_x <= (mon_x + threshold);
            let in_y_range = cursor_y >= (pill_y - 30) && cursor_y <= (pill_y + pill_h + 30);
            in_x_range && in_y_range
        }
        DockPosition::RightEdge { y_ratio } => {
            let safe_ratio = y_ratio.clamp(0.0, 1.0);
            let available_h = mon_size.height.saturating_sub(pill_h as u32) as f32;
            let pill_y = mon_y + (available_h * safe_ratio).round() as i32;
            let in_x_range = cursor_x >= (mon_max_x - threshold) && cursor_x <= mon_max_x;
            let in_y_range = cursor_y >= (pill_y - 30) && cursor_y <= (pill_y + pill_h + 30);
            in_x_range && in_y_range
        }
    }
}

pub fn wake_up_from_idle(window: &WebviewWindow) {
    set_idle_hidden_state(false);
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = update_island_geometry(window, IslandState::Collapsed);
    let _ = window.emit("edge-hover-wakeup", ());
    let _ = window.emit("island-state-changed", IslandState::Collapsed);
}
