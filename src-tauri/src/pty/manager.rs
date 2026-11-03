use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::Duration;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::session::{PtySession, PtyStatusPayload};

#[derive(Clone, Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(
        &self,
        app_handle: &AppHandle,
        shell_path: Option<String>,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(10),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to create PTY pair: {}", e))?;

        // Determine default shell for target OS
        let default_shell = if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        };

        let chosen_shell = shell_path.unwrap_or(default_shell);
        let mut cmd = CommandBuilder::new(&chosen_shell);

        // Variables de entorno de terminal esenciales para Zsh (zle), Fish y autosuggestions
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "ObsidianShell");

        // Asegurar codificación UTF-8 para Linux/Unix
        let user_lang = std::env::var("LANG").unwrap_or_default();
        let user_lc_all = std::env::var("LC_ALL").unwrap_or_default();
        if !user_lang.to_uppercase().contains("UTF-8") && !user_lc_all.to_uppercase().contains("UTF-8") {
            cmd.env("LANG", "C.UTF-8");
        } else if !user_lang.is_empty() {
            cmd.env("LANG", user_lang);
        }

        let home_dir = if cfg!(target_os = "windows") {
            std::env::var("USERPROFILE").ok()
        } else {
            std::env::var("HOME").ok()
        };

        let effective_cwd = cwd.or(home_dir);
        if let Some(ref dir) = effective_cwd {
            if std::path::Path::new(dir).exists() {
                cmd.cwd(dir);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell '{}': {}", chosen_shell, e))?;

        let child_pid = child.process_id();

        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take master writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone master reader: {}", e))?;

        let session_id = Uuid::new_v4().to_string();
        let session = PtySession::new(
            session_id.clone(),
            child_pid,
            effective_cwd.clone(),
            writer,
            pair.master,
            child,
            chosen_shell.clone(),
            cols,
            rows,
        );

        let reader_session_id = session_id.clone();
        let app_handle_clone = app_handle.clone();
        let child_arc = session.child.clone();
        let shell_name_for_event = std::path::Path::new(&chosen_shell)
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or(&chosen_shell)
            .to_string();

        // Spawn background reader and batching thread
        std::thread::spawn(move || {
            let (tx, rx) = channel::<Vec<u8>>();
            let emit_session_id = reader_session_id.clone();
            let emit_app = app_handle_clone.clone();

            // Producer thread (Pure unblocked drain): reads in continuous loop with 64 KB buffer without sleeping
            std::thread::spawn(move || {
                let mut buf = [0u8; 65536];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            });

            // Consumer thread (IPC emitter at 60 Hz): receives from rx, drains pending with try_recv()
            let mut accumulated: Vec<u8> = Vec::with_capacity(65536);
            while let Ok(first_chunk) = rx.recv() {
                accumulated.extend_from_slice(&first_chunk);
                while let Ok(chunk) = rx.try_recv() {
                    accumulated.extend_from_slice(&chunk);
                }

                // Entrega íntegra sin recorte destructivo para preservar secuencias de cursor ANSI
                let data_to_send = std::mem::take(&mut accumulated);

                let text = String::from_utf8_lossy(&data_to_send).to_string();
                let event_name = format!("pty-output-{}", emit_session_id);
                let _ = emit_app.emit(&event_name, text);

                std::thread::sleep(Duration::from_millis(12));
            }

            // Detect process exit
            let exit_code = {
                let mut child_lock = child_arc.lock();
                child_lock.wait().ok().map(|s| s.exit_code() as i32)
            };

            let status_event = format!("pty-status-{}", reader_session_id);
            let _ = app_handle_clone.emit(
                &status_event,
                PtyStatusPayload {
                    session_id: reader_session_id,
                    foreground_process: shell_name_for_event,
                    is_busy: false,
                    exit_code,
                },
            );
        });

        // Store active session
        self.sessions.lock().insert(session_id.clone(), session);

        Ok(session_id)
    }

    pub fn write_to_pty(&self, session_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(session_id) {
            session.write(data.as_bytes())
        } else {
            Err(format!("PTY session not found: {}", session_id))
        }
    }

    pub fn resize_pty(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(session_id) {
            session.resize(cols, rows)
        } else {
            Err(format!("PTY session not found: {}", session_id))
        }
    }

    pub fn kill_pty_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.remove(session_id) {
            let _ = session.kill();
            Ok(())
        } else {
            Err(format!("PTY session not found: {}", session_id))
        }
    }

    pub fn get_session_cwd(&self, session_id: &str) -> Option<String> {
        let (pid, initial_cwd) = {
            let sessions = self.sessions.lock();
            let session = sessions.get(session_id)?;
            (session.pid, session.initial_cwd.clone())
        };

        if let Some(pid_num) = pid {
            let mut sys = System::new();
            sys.refresh_processes(ProcessesToUpdate::All, true);

            let target_pid = Pid::from_u32(pid_num);

            // 1. Check if there are active child processes belonging to target_pid
            let mut deepest_cwd: Option<String> = None;
            for proc in sys.processes().values() {
                if proc.parent() == Some(target_pid) {
                    if let Some(cwd) = proc.cwd() {
                        let path_str = cwd.to_string_lossy().to_string();
                        if !path_str.is_empty() && std::path::Path::new(&path_str).exists() {
                            deepest_cwd = Some(path_str);
                            break;
                        }
                    }
                }
            }

            if deepest_cwd.is_some() {
                return deepest_cwd;
            }

            // 2. Check the shell process itself
            if let Some(proc) = sys.process(target_pid) {
                if let Some(cwd) = proc.cwd() {
                    let path_str = cwd.to_string_lossy().to_string();
                    if !path_str.is_empty() && std::path::Path::new(&path_str).exists() {
                        return Some(path_str);
                    }
                }
            }
        }

        // 3. Fallback to initial_cwd if valid
        if let Some(ref cwd) = initial_cwd {
            if std::path::Path::new(cwd).exists() {
                return Some(cwd.clone());
            }
        }

        None
    }

    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, session) in sessions.drain() {
            let _ = session.kill();
        }
    }
}
