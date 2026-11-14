//! Sign in with your phone (Google TV sign-in screen).
//!
//! While the sign-in screen is open the app serves one small page on the home
//! network. The TV shows a QR code that links to it with a one-time code. What
//! is typed on the phone is handed to the sign-in screen (event `pair-login`),
//! which signs in exactly like the remote would. Nothing leaves the house, and
//! the page stops the moment the sign-in screen closes.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

struct Pairing {
    stop: Arc<AtomicBool>,
    state: Arc<Mutex<String>>,
}

static CURRENT: Mutex<Option<Pairing>> = Mutex::new(None);

const PAGE: &str = include_str!("pair.html");

fn local_ip() -> Option<String> {
    // No packet is sent: this only asks the system which address it would use.
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    let ip = s.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() { None } else { Some(ip.to_string()) }
}

fn reply(mut s: &TcpStream, status: &str, ctype: &str, body: &str) {
    let _ = write!(
        s,
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn handle(mut s: TcpStream, code: &str, state: &Arc<Mutex<String>>, app: &AppHandle) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(4)));
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 2048];
    let mut head_end = None;
    while head_end.is_none() && buf.len() < 16384 {
        match s.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
        head_end = buf.windows(4).position(|w| w == b"\r\n\r\n");
    }
    let Some(he) = head_end else { return };
    let head = String::from_utf8_lossy(&buf[..he]).to_string();
    let mut first = head.lines().next().unwrap_or("").split(' ');
    let method = first.next().unwrap_or("");
    let path = first.next().unwrap_or("");
    let len: usize = head
        .lines()
        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
        .unwrap_or(0)
        .min(8192);
    let mut body = buf[he + 4..].to_vec();
    while body.len() < len {
        match s.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => body.extend_from_slice(&tmp[..n]),
        }
    }
    let base = format!("/{code}");
    if method == "GET" && path == base {
        reply(&s, "200 OK", "text/html; charset=utf-8", PAGE);
    } else if method == "GET" && path == format!("{base}/state") {
        let st = state.lock().map(|g| g.clone()).unwrap_or_default();
        reply(&s, "200 OK", "application/json", if st.is_empty() { "{}" } else { &st });
    } else if method == "POST" && path == format!("{base}/login") {
        match serde_json::from_slice::<Value>(&body) {
            Ok(v) => {
                let _ = app.emit("pair-login", v);
                reply(&s, "200 OK", "application/json", "{\"ok\":true}");
            }
            Err(_) => reply(&s, "400 Bad Request", "text/plain", "bad request"),
        }
    } else {
        reply(&s, "404 Not Found", "text/plain", "This sign-in link is no longer active.");
    }
}

/// Starts the page and returns its link plus a QR code (SVG) for it.
#[tauri::command]
pub fn pair_start(app: AppHandle) -> Result<Value, String> {
    pair_stop();
    let ip = local_ip().ok_or("This TV is not on a network.")?;
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let code: String = uuid::Uuid::new_v4().simple().to_string()[..10].to_string();
    let url = format!("http://{ip}:{port}/{code}");
    let qr = qrcode::QrCode::new(url.as_bytes())
        .map_err(|e| e.to_string())?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(false)
        .build();
    let stop = Arc::new(AtomicBool::new(false));
    let state = Arc::new(Mutex::new(String::new()));
    {
        let (stop, state, code) = (stop.clone(), state.clone(), code.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((s, _)) => {
                        let _ = s.set_nonblocking(false);
                        handle(s, &code, &state, &app);
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(120)),
                }
            }
        });
    }
    if let Ok(mut c) = CURRENT.lock() {
        *c = Some(Pairing { stop, state });
    }
    Ok(json!({ "url": url, "qr": qr }))
}

/// What the phone page shows: which servers are signed in, and the result of its last try.
#[tauri::command]
pub fn pair_state(state: Value) {
    if let Ok(c) = CURRENT.lock() {
        if let Some(p) = c.as_ref() {
            if let Ok(mut s) = p.state.lock() {
                *s = state.to_string();
            }
        }
    }
}

#[tauri::command]
pub fn pair_stop() {
    if let Ok(mut c) = CURRENT.lock() {
        if let Some(p) = c.take() {
            p.stop.store(true, Ordering::Relaxed);
        }
    }
}
