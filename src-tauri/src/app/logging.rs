//! 应用日志：写入平台日志目录，超过 2 MB 滚动为 `.1` 保留一份。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_BYTES: u64 = 2 * 1024 * 1024;

static LOG_FILE: OnceLock<Mutex<File>> = OnceLock::new();

pub fn init(path: &Path) {
    if LOG_FILE.get().is_some() {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    rotate_if_needed(path);
    let file = OpenOptions::new().create(true).append(true).open(path);
    if let Ok(file) = file {
        let _ = LOG_FILE.set(Mutex::new(file));
    }
}

pub fn log(level: &str, message: &str) {
    let line = format!("[{}] {level} {message}\n", timestamp());
    if let Some(file) = LOG_FILE.get() {
        if let Ok(mut file) = file.lock() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
    #[cfg(debug_assertions)]
    eprint!("{line}");
}

pub fn info(message: &str) {
    log("INFO", message);
}

pub fn warn(message: &str) {
    log("WARN", message);
}

fn rotate_if_needed(path: &Path) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.len() <= MAX_BYTES {
        return;
    }
    let backup = PathBuf::from(format!("{}.1", path.display()));
    let _ = std::fs::remove_file(&backup);
    let _ = std::fs::rename(path, backup);
}

fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}
