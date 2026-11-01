use std::io::Write;
use std::sync::Arc;
use parking_lot::Mutex;
use portable_pty::{Child, MasterPty};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyStatusPayload {
    pub session_id: String,
    pub foreground_process: String,
    pub is_busy: bool,
    pub exit_code: Option<i32>,
}

pub struct PtySession {
    pub id: String,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    pub shell_path: String,
    pub cols: u16,
    pub rows: u16,
}

impl PtySession {
    pub fn new(
        id: String,
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send + Sync>,
        shell_path: String,
        cols: u16,
        rows: u16,
    ) -> Self {
        Self {
            id,
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(master)),
            child: Arc::new(Mutex::new(child)),
            shell_path,
            cols,
            rows,
        }
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock();
        writer.write_all(data).map_err(|e| format!("Write failed: {}", e))?;
        writer.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.cols = cols;
        self.rows = rows;
        let master = self.master.lock();
        master
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    }

    pub fn kill(&self) -> Result<(), String> {
        let mut child = self.child.lock();
        child.kill().map_err(|e| format!("Kill failed: {}", e))?;
        Ok(())
    }
}
