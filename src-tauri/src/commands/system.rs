use tauri::{AppHandle, State};
use crate::pty::PtyManager;
use crate::state::SystemMetricsHolder;

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemMetrics {
    pub cpu_usage: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_percent: f32,
}

#[tauri::command]
pub fn get_system_metrics(system_holder: State<SystemMetricsHolder>) -> SystemMetrics {
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
pub fn quit_app_immediately(app: AppHandle, pty_manager: State<PtyManager>) {
    pty_manager.kill_all();
    app.exit(0);
}
