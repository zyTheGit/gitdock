use std::cell::RefCell;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Backend {
    Portable,
    Conpty,
}

struct Session {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    resize: Box<dyn FnMut(u16, u16) -> Result<(), String>>,
    wait: Box<dyn FnMut(Duration) -> Result<Option<i32>, String>>,
    kill: Box<dyn FnMut() -> Result<(), String>>,
}

#[cfg(feature = "portable")]
fn spawn_portable(cwd: &PathBuf, argv: &[String], cols: u16, rows: u16) -> Result<Session, String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(&argv[0]);
    for arg in &argv[1..] {
        cmd.arg(arg);
    }
    cmd.cwd(cwd);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let master = Rc::new(pair.master);
    let child = Rc::new(RefCell::new(child));
    let resize_master = master.clone();
    let resize = Box::new(move |c: u16, r: u16| {
        resize_master
            .resize(PtySize {
                rows: r,
                cols: c,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    });
    let wait_child = child.clone();
    let wait = Box::new(move |timeout: Duration| {
        let start = Instant::now();
        loop {
            match wait_child.borrow_mut().try_wait().map_err(|e| e.to_string())? {
                Some(status) => return Ok(Some(status.exit_code() as i32)),
                None if start.elapsed() >= timeout => return Ok(None),
                None => std::thread::sleep(Duration::from_millis(20)),
            }
        }
    });
    let kill = Box::new(move || child.borrow_mut().kill().map_err(|e| e.to_string()));
    Ok(Session {
        reader,
        writer,
        resize,
        wait,
        kill,
    })
}

#[cfg(feature = "conpty")]
fn spawn_conpty(cwd: &PathBuf, argv: &[String], cols: u16, rows: u16) -> Result<Session, String> {
    use conpty::ProcessOptions;
    use std::process::Command;

    let mut cmd = Command::new(&argv[0]);
    for arg in &argv[1..] {
        cmd.arg(arg);
    }
    cmd.current_dir(cwd);
    let mut options = ProcessOptions::default();
    options.set_console_size(Some((cols as i16, rows as i16)));
    let mut proc = options.spawn(cmd).map_err(|e| e.to_string())?;
    let reader: Box<dyn Read + Send> = Box::new(proc.output().map_err(|e| e.to_string())?);
    let writer: Box<dyn Write + Send> = Box::new(proc.input().map_err(|e| e.to_string())?);
    let proc = Rc::new(RefCell::new(proc));
    let resize_proc = proc.clone();
    let resize = Box::new(move |c: u16, r: u16| {
        resize_proc
            .borrow_mut()
            .resize(c as i16, r as i16)
            .map_err(|e| e.to_string())
    });
    let wait_proc = proc.clone();
    let wait = Box::new(move |timeout: Duration| {
        let ms = timeout.as_millis().min(u32::MAX as u128) as u32;
        match wait_proc.borrow().wait(Some(ms)) {
            Ok(code) => Ok(Some(code as i32)),
            Err(conpty::error::Error::Timeout(_)) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    });
    let kill = Box::new(move || proc.borrow_mut().exit(0).map_err(|e| e.to_string()));
    Ok(Session {
        reader,
        writer,
        resize,
        wait,
        kill,
    })
}

fn spawn(
    backend: Backend,
    cwd: &PathBuf,
    argv: &[String],
    cols: u16,
    rows: u16,
) -> Result<Session, String> {
    match backend {
        Backend::Portable => {
            #[cfg(feature = "portable")]
            {
                spawn_portable(cwd, argv, cols, rows)
            }
            #[cfg(not(feature = "portable"))]
            {
                let _ = (cwd, argv, cols, rows);
                Err("built without portable feature".into())
            }
        }
        Backend::Conpty => {
            #[cfg(feature = "conpty")]
            {
                spawn_conpty(cwd, argv, cols, rows)
            }
            #[cfg(not(feature = "conpty"))]
            {
                let _ = (cwd, argv, cols, rows);
                Err("built without conpty feature".into())
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: terminal-probe <portable|conpty> <cwd> <command> [args...]");
        std::process::exit(2);
    }
    let backend = match args[1].as_str() {
        "portable" => Backend::Portable,
        "conpty" => Backend::Conpty,
        other => {
            eprintln!("unknown backend {other}");
            std::process::exit(2);
        }
    };
    let cwd = PathBuf::from(&args[2]);
    let argv: Vec<String> = args[3..].to_vec();
    let session = match spawn(backend, &cwd, &argv, 80, 24) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("SPAWN_ERROR {e}");
            std::process::exit(3);
        }
    };
    let Session {
        reader,
        mut writer,
        mut resize,
        mut wait,
        mut kill,
    } = session;
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
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

    let send_after_ms: u64 = std::env::var("PROBE_SEND_AFTER_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let payload = std::env::var("PROBE_SEND").unwrap_or_default();
    let read_ms: u64 = std::env::var("PROBE_READ_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2500);
    let start = Instant::now();
    let mut out = Vec::new();
    let deadline = start + Duration::from_millis(read_ms);
    let mut sent = false;
    let mut answered_dsr = false;
    while Instant::now() < deadline {
        if !payload.is_empty() && !sent && start.elapsed() >= Duration::from_millis(send_after_ms) {
            let _ = writer.write_all(payload.as_bytes());
            let _ = writer.flush();
            sent = true;
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => {
                out.extend_from_slice(&chunk);
                if !answered_dsr && out.windows(4).any(|w| w == b"\x1b[6n") {
                    let _ = writer.write_all(b"\x1b[1;1R");
                    let _ = writer.flush();
                    answered_dsr = true;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
        if out.len() > 256 * 1024 {
            break;
        }
    }
    let status = wait(Duration::from_secs(2));
    let resize_result = resize(100, 30);
    let kill_result = kill();
    let as_text = String::from_utf8_lossy(&out);
    let mut preview = as_text.chars().take(300).collect::<String>();
    preview = preview.replace('\u{1b}', "<ESC>").replace('\r', "<CR>");
    println!("BACKEND={backend:?}");
    println!("BYTES={}", out.len());
    println!("EXIT={status:?}");
    println!("RESIZE={resize_result:?}");
    println!("KILL={kill_result:?}");
    println!("HAS_ESC={}", out.contains(&0x1b));
    println!("HAS_CJK={}", as_text.contains('中') || as_text.contains('文'));
    println!("PREVIEW={preview:?}");
}
