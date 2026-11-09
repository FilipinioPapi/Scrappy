//! Follow-along text for audiobooks (approved mock "Follow-along text").
//!
//! While the Follow along panel is open, a worker turns the next few minutes of the
//! book into text with whisper.cpp (bundled, uses the graphics card through Vulkan,
//! or the processor). Each minute of the book is saved once as a small JSON file, so
//! listening again costs nothing. Closing the panel stops the worker straight away.
//!
//! Audio: a throwaway mpv instance writes 16 kHz mono WAV with its "pcm" audio output,
//! as fast as it can decode. That handles every format Audiobookshelf serves (m4b, mp3…).

use crate::{mpv, servers, AppState};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Seconds of book per saved piece of text.
const CHUNK: f64 = 60.0;
/// Extra audio decoded on each side of a piece, so words cut at the edge come out whole.
const PAD: f64 = 2.0;

// ---------- What this PC has ----------

#[derive(Clone, Debug, Default)]
struct Hw {
    gpu: String,
    vram_mb: u64,
    threads: usize,
    ram_mb: u64,
}

#[cfg(windows)]
fn detect() -> Hw {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut hw = Hw { threads: threads(), ..Default::default() };
    // The graphics card with the most memory of its own (no admin rights needed).
    unsafe {
        if let Ok(f) = CreateDXGIFactory1::<IDXGIFactory1>() {
            let mut i = 0;
            while let Ok(a) = f.EnumAdapters1(i) {
                i += 1;
                let Ok(d) = a.GetDesc1() else { continue };
                if d.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 || d.VendorId == 0x1414 {
                    continue; // Microsoft's software renderer
                }
                let vram = d.DedicatedVideoMemory as u64 / (1024 * 1024);
                let name = String::from_utf16_lossy(&d.Description).trim_end_matches('\0').trim().to_string();
                if hw.gpu.is_empty() || vram > hw.vram_mb {
                    hw.gpu = name;
                    hw.vram_mb = vram;
                }
            }
        }
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        if GlobalMemoryStatusEx(&mut m).is_ok() {
            hw.ram_mb = m.ullTotalPhys / (1024 * 1024);
        }
    }
    hw
}

#[cfg(not(windows))]
fn detect() -> Hw {
    Hw { gpu: String::new(), vram_mb: 0, threads: threads(), ram_mb: 8192 }
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
}

/// A graphics card with this much memory of its own runs the big model.
const GPU_MIN_MB: u64 = 3500;

#[derive(Clone, Copy, PartialEq)]
enum Tier {
    Best,
    Good,
    Basic,
}

fn tier(hw: &Hw) -> Tier {
    if hw.vram_mb >= GPU_MIN_MB {
        Tier::Best
    } else if hw.threads >= 8 && hw.ram_mb >= 7000 {
        Tier::Good
    } else {
        Tier::Basic
    }
}

/// (file name, download size in MB, label)
const MODELS: [(&str, u64, &str); 3] = [
    ("ggml-base.bin", 142, "Light model"),
    ("ggml-small.bin", 466, "Smaller model"),
    ("ggml-large-v3-turbo-q5_0.bin", 547, "Most accurate model"),
];

/// Which model and whether to use the graphics card, for a tier and the user's choice
/// ("auto", "fast" or "best").
fn plan(t: Tier, quality: &str) -> (usize, bool) {
    let gpu = t == Tier::Best;
    let base: usize = match t {
        Tier::Best => 2,
        Tier::Good => 1,
        Tier::Basic => 0,
    };
    let m = match quality {
        "fast" => base.saturating_sub(1),
        "best" => (base + 1).min(2),
        _ => base,
    };
    (m, gpu)
}

/// Minutes of book to keep ready ahead of where you are.
fn ahead_secs(t: Tier) -> f64 {
    match t {
        Tier::Best => 600.0,
        Tier::Good => 300.0,
        Tier::Basic => 150.0,
    }
}

// ---------- Where things live ----------

fn engine(app: &AppHandle) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let mut dirs = vec![];
    if let Ok(r) = app.path().resource_dir() {
        dirs.push(r.join("whisper"));
    }
    if let Ok(e) = std::env::current_exe() {
        if let Some(d) = e.parent() {
            dirs.push(d.join("whisper"));
        }
    }
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
}

fn models_dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("speech")
}

fn text_dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("follow-along")
}

fn safe(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

fn chunk_path(app: &AppHandle, book: &str, k: u64) -> PathBuf {
    text_dir(app).join(safe(book)).join(format!("{k:06}.json"))
}

// ---------- Commands ----------

/// What this PC has and what follow-along will use. Cheap: the hardware check runs once.
#[tauri::command]
pub fn fa_info(app: AppHandle, quality: Option<String>) -> Value {
    let hw = hw();
    let t = tier(&hw);
    let (m, gpu) = plan(t, quality.as_deref().unwrap_or("auto"));
    let (file, mb, label) = MODELS[m];
    json!({
        "gpu": hw.gpu, "vramMb": hw.vram_mb, "threads": hw.threads, "ramMb": hw.ram_mb,
        "tier": match t { Tier::Best => "best", Tier::Good => "good", Tier::Basic => "basic" },
        "useGpu": gpu, "model": label, "modelMb": mb,
        "haveModel": models_dir(&app).join(file).is_file(),
        "engine": engine(&app).is_some(),
        "aheadMin": (ahead_secs(t) / 60.0).round(),
    })
}

fn hw() -> Hw {
    static HW: Mutex<Option<Hw>> = Mutex::new(None);
    HW.lock().unwrap().get_or_insert_with(detect).clone()
}

#[derive(Deserialize, Clone)]
pub struct Track {
    path: String,
    offset: f64,
    duration: f64,
}

struct Job {
    book: String,
    cancel: Arc<AtomicBool>,
    pos: Arc<Mutex<f64>>,
}
static JOB: Mutex<Option<Job>> = Mutex::new(None);

/// Start (or keep going) for this book from `pos` seconds. Only runs while the panel is open.
#[tauri::command]
pub fn fa_start(app: AppHandle, state: State<'_, AppState>, book: String, tracks: Vec<Track>, pos: f64, quality: Option<String>) -> Result<(), String> {
    let mut job = JOB.lock().unwrap();
    if let Some(j) = job.as_ref() {
        if j.book == book && !j.cancel.load(Ordering::Relaxed) {
            *j.pos.lock().unwrap() = pos;
            return Ok(());
        }
        j.cancel.store(true, Ordering::Relaxed);
    }
    let exe = engine(&app).ok_or("The speech engine is missing from this copy of Scrappy.")?;
    if tracks.is_empty() {
        return Err("This book has no audio files.".into());
    }
    let cfg = state.cfg();
    let urls: Vec<(String, f64, f64)> = tracks.iter().map(|t| (servers::abs_file_url(&cfg, &t.path), t.offset, t.duration)).collect();
    let cancel = Arc::new(AtomicBool::new(false));
    let posm = Arc::new(Mutex::new(pos));
    *job = Some(Job { book: book.clone(), cancel: cancel.clone(), pos: posm.clone() });
    let q = quality.unwrap_or_else(|| "auto".into());
    let dirs = state.mpv_dirs.clone();
    std::thread::spawn(move || {
        let w = Worker { app: app.clone(), book, urls, exe, dirs, cancel: cancel.clone(), pos: posm, lang: "auto".into() };
        if let Err(e) = w.run(&q) {
            if !cancel.load(Ordering::Relaxed) {
                let _ = app.emit("fa-status", json!({ "state": "error", "msg": e }));
            }
        }
    });
    Ok(())
}

/// Where the listener is now (sent every few seconds while the panel is open).
#[tauri::command]
pub fn fa_pos(pos: f64) {
    if let Some(j) = JOB.lock().unwrap().as_ref() {
        *j.pos.lock().unwrap() = pos;
    }
}

/// The panel closed: stop at once.
#[tauri::command]
pub fn fa_stop() {
    if let Some(j) = JOB.lock().unwrap().take() {
        j.cancel.store(true, Ordering::Relaxed);
    }
}

/// Every saved piece of text for a book.
#[tauri::command]
pub fn fa_cached(app: AppHandle, book: String) -> Vec<Value> {
    let dir = text_dir(&app).join(safe(&book));
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if let Ok(s) = std::fs::read_to_string(e.path()) {
                if let Ok(v) = serde_json::from_str::<Value>(&s) {
                    out.push(v);
                }
            }
        }
    }
    out
}

/// How much saved text there is: { mb, books, chunks }.
#[tauri::command]
pub fn fa_saved(app: AppHandle) -> Value {
    let (mut bytes, mut books, mut chunks) = (0u64, 0u64, 0u64);
    if let Ok(rd) = std::fs::read_dir(text_dir(&app)) {
        for b in rd.flatten() {
            books += 1;
            if let Ok(rd2) = std::fs::read_dir(b.path()) {
                for c in rd2.flatten() {
                    chunks += 1;
                    bytes += c.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
    }
    json!({ "bytes": bytes, "books": books, "chunks": chunks })
}

#[tauri::command]
pub fn fa_clear(app: AppHandle) -> Result<(), String> {
    fa_stop();
    let d = text_dir(&app);
    if d.exists() {
        std::fs::remove_dir_all(&d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- The worker ----------

struct Worker {
    app: AppHandle,
    book: String,
    /// (stream address, where the file starts in the book, its length)
    urls: Vec<(String, f64, f64)>,
    exe: PathBuf,
    dirs: Vec<PathBuf>,
    cancel: Arc<AtomicBool>,
    pos: Arc<Mutex<f64>>,
    lang: String,
}

impl Worker {
    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn status(&self, v: Value) {
        if !self.stopped() {
            let _ = self.app.emit("fa-status", v);
        }
    }

    fn run(mut self, quality: &str) -> Result<(), String> {
        let hw = hw();
        let t = tier(&hw);
        let (m, mut gpu) = plan(t, quality);
        let model = self.ensure_model(m)?;
        let total: f64 = self.urls.iter().map(|u| u.1 + u.2).fold(0.0, f64::max);
        let last = (total / CHUNK).ceil().max(1.0) as u64 - 1;
        let work = std::env::temp_dir().join(format!("scrappy-fa-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&work);
        let mut speed = 0.0f64; // seconds of audio per second of work, measured
        while !self.stopped() {
            let pos = *self.pos.lock().unwrap();
            let k0 = (pos.max(0.0) / CHUNK).floor() as u64;
            let kmax = (((pos + ahead_secs(t)) / CHUNK).floor() as u64).min(last);
            let next = (k0..=kmax).find(|k| !chunk_path(&self.app, &self.book, *k).is_file());
            let ready_to = next.map(|k| k as f64 * CHUNK).unwrap_or(((kmax + 1) as f64 * CHUNK).min(total));
            self.status(json!({ "state": "running", "on": if gpu { "gpu" } else { "cpu" }, "ahead": (ready_to - pos).max(0.0), "speed": speed }));
            let Some(k) = next else {
                std::thread::sleep(Duration::from_millis(800));
                continue;
            };
            let started = Instant::now();
            match self.transcribe(k, &model, gpu, &work) {
                Ok(v) => {
                    let p = chunk_path(&self.app, &self.book, k);
                    let _ = std::fs::create_dir_all(p.parent().unwrap());
                    let _ = std::fs::write(&p, v.to_string());
                    let secs = started.elapsed().as_secs_f64().max(0.1);
                    speed = if speed == 0.0 { CHUNK / secs } else { speed * 0.6 + (CHUNK / secs) * 0.4 };
                    if !self.stopped() {
                        let _ = self.app.emit("fa-chunk", v);
                    }
                }
                Err(e) if gpu && !self.stopped() && e.starts_with("ENGINE") => {
                    // The graphics card didn't work out: carry on with the processor.
                    gpu = false;
                }
                Err(e) => {
                    let _ = std::fs::remove_dir_all(&work);
                    return Err(e.trim_start_matches("ENGINE ").to_string());
                }
            }
        }
        let _ = std::fs::remove_dir_all(&work);
        Ok(())
    }

    /// Download the speech model once (shows "Getting set up" in the panel).
    fn ensure_model(&self, m: usize) -> Result<PathBuf, String> {
        let (file, mb, _) = MODELS[m];
        let dir = models_dir(&self.app);
        let path = dir.join(file);
        if path.is_file() {
            return Ok(path);
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}");
        let part = dir.join(format!("{file}.part"));
        self.status(json!({ "state": "setup", "pct": 0 }));
        let res = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
            let mut r = client.get(&url).send().await.map_err(|e| format!("Couldn't download the speech model: {e}"))?;
            if !r.status().is_success() {
                return Err(format!("Couldn't download the speech model (error {}).", r.status().as_u16()));
            }
            let len = r.content_length().unwrap_or(mb * 1024 * 1024).max(1);
            let mut f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
            let (mut got, mut shown) = (0u64, 0u64);
            while let Some(c) = r.chunk().await.map_err(|e| format!("The download stopped: {e}"))? {
                if self.stopped() {
                    return Err("stopped".into());
                }
                use std::io::Write;
                f.write_all(&c).map_err(|e| e.to_string())?;
                got += c.len() as u64;
                let pct = got * 100 / len;
                if pct != shown {
                    shown = pct;
                    self.status(json!({ "state": "setup", "pct": pct.min(99) }));
                }
            }
            Ok(())
        });
        if let Err(e) = res {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
        std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
        Ok(path)
    }

    /// Text for book seconds [k*CHUNK, (k+1)*CHUNK).
    fn transcribe(&mut self, k: u64, model: &Path, gpu: bool, work: &Path) -> Result<Value, String> {
        let (s, e) = (k as f64 * CHUNK, (k + 1) as f64 * CHUNK);
        let mut words: Vec<(f64, f64, String)> = vec![];
        let pieces: Vec<(String, f64, f64)> = self.urls.iter().filter(|u| u.1 < e + PAD && u.1 + u.2 > s - PAD).cloned().collect();
        for (url, off, dur) in pieces {
            if self.stopped() {
                return Err("stopped".into());
            }
            let a = (s - PAD - off).max(0.0);
            let b = (e + PAD - off).min(dur);
            if b - a < 0.5 {
                continue;
            }
            let wav = work.join("piece.wav");
            let _ = std::fs::remove_file(&wav);
            decode(&self.dirs, &url, a, b - a, &wav, &self.cancel)?;
            for (t0, t1, w) in self.whisper(&wav, model, gpu, work)? {
                words.push((off + a + t0, off + a + t1, w));
            }
        }
        // Keep the words that start inside this piece; the padding only makes edges whole.
        words.retain(|w| w.0 >= s && w.0 < e);
        words.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
        let w: Vec<Value> = words.iter().map(|(a, b, t)| json!([(a * 100.0).round() / 100.0, (b * 100.0).round() / 100.0, t])).collect();
        Ok(json!({ "book": self.book, "k": k, "start": s, "end": e, "words": w }))
    }

    /// Run whisper.cpp on a WAV file: [(start, end, word)] in seconds from the file start.
    fn whisper(&mut self, wav: &Path, model: &Path, gpu: bool, work: &Path) -> Result<Vec<(f64, f64, String)>, String> {
        let out = work.join("piece");
        let json_path = work.join("piece.json");
        let _ = std::fs::remove_file(&json_path);
        let th = (hw().threads / 2).clamp(1, 8).to_string();
        let mut cmd = Command::new(&self.exe);
        cmd.arg("-m").arg(model).arg("-f").arg(wav).arg("-of").arg(&out);
        cmd.args(["-ojf", "-np", "-t", &th, "-l", &self.lang]);
        if !gpu {
            cmd.arg("-ng");
        }
        if let Some(d) = self.exe.parent() {
            cmd.current_dir(d);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // no console window
        }
        let mut child = cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().map_err(|e| format!("ENGINE couldn't start the speech engine: {e}"))?;
        let status = loop {
            if self.stopped() {
                let _ = child.kill();
                return Err("stopped".into());
            }
            match child.try_wait() {
                Ok(Some(st)) => break st,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(format!("ENGINE {e}")),
            }
        };
        if !status.success() {
            return Err("ENGINE The speech engine stopped with an error.".into());
        }
        let raw = std::fs::read(&json_path).map_err(|_| "ENGINE The speech engine gave no text.".to_string())?;
        let v: Value = serde_json::from_str(&String::from_utf8_lossy(&raw)).map_err(|e| format!("ENGINE {e}"))?;
        if self.lang == "auto" {
            if let Some(l) = v["result"]["language"].as_str().filter(|l| !l.is_empty()) {
                self.lang = l.to_string(); // keep the book's language from here on
            }
        }
        // Tokens -> words: a token starting with a space starts a new word.
        let mut words: Vec<(f64, f64, String)> = vec![];
        for seg in v["transcription"].as_array().into_iter().flatten() {
            for tok in seg["tokens"].as_array().into_iter().flatten() {
                let t = tok["text"].as_str().unwrap_or("");
                if t.is_empty() || t.starts_with("[_") || t.starts_with("<|") {
                    continue;
                }
                let a = tok["offsets"]["from"].as_f64().unwrap_or(-1.0) / 1000.0;
                let b = tok["offsets"]["to"].as_f64().unwrap_or(-1.0) / 1000.0;
                let new_word = t.starts_with(' ') || words.is_empty();
                if new_word {
                    words.push((a.max(0.0), b.max(a).max(0.0), t.trim_start().to_string()));
                } else if let Some(w) = words.last_mut() {
                    w.2.push_str(t);
                    if b > w.1 {
                        w.1 = b;
                    }
                }
            }
        }
        words.retain(|w| !w.2.trim().is_empty());
        Ok(words)
    }
}

/// Write `len` seconds from `start` of an audio stream to a 16 kHz mono WAV file.
fn decode(dirs: &[PathBuf], url: &str, start: f64, len: f64, out: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<mpv::Event>();
    let opts: Vec<(&str, String)> = vec![
        ("config", "no".into()),
        ("terminal", "no".into()),
        ("idle", "yes".into()),
        ("video", "no".into()),
        ("audio-display", "no".into()),
        ("input-default-bindings", "no".into()),
        ("user-agent", "Scrappy/mpv".into()),
        ("ao", "pcm".into()),
        ("ao-pcm-file", out.to_string_lossy().to_string()),
        ("ao-pcm-waveheader", "yes".into()),
        ("untimed", "yes".into()),
        ("audio-samplerate", "16000".into()),
        ("audio-channels", "mono".into()),
        ("audio-format", "s16".into()),
        ("start", format!("{start:.2}")),
        ("length", format!("{len:.2}")),
    ];
    let p = mpv::Player::create(dirs, &opts, &[], move |ev| {
        let _ = tx.send(ev);
    })?;
    p.command(&["loadfile", url])?;
    let t0 = Instant::now();
    let mut err = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(mpv::Event::EndFile { error, .. }) => {
                err = error;
                break;
            }
            Ok(mpv::Event::Shutdown) => break,
            Ok(_) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if cancel.load(Ordering::Relaxed) {
                    err = Some("stopped".into());
                    break;
                }
                if t0.elapsed() > Duration::from_secs(180) {
                    err = Some("Reading the audio took too long.".into());
                    break;
                }
            }
            Err(_) => break,
        }
    }
    // Quitting closes the audio output, which finishes the WAV file.
    p.quit();
    let t1 = Instant::now();
    while t1.elapsed() < Duration::from_secs(5) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(mpv::Event::Shutdown) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            _ => {}
        }
    }
    if let Some(e) = err {
        return Err(e);
    }
    if std::fs::metadata(out).map(|m| m.len()).unwrap_or(0) < 1000 {
        return Err("Couldn't read this part of the book.".into());
    }
    Ok(())
}
