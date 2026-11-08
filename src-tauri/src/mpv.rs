//! A small wrapper around libmpv, loaded at runtime from libmpv-2.dll.
//! Each playback gets its own mpv instance running on a background thread.

use libloading::Library;
use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

type Handle = *mut c_void;

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

const EVENT_SHUTDOWN: c_int = 1;
const EVENT_END_FILE: c_int = 7;
const END_FILE_REASON_ERROR: c_int = 4;

struct Api {
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    wait_event: unsafe extern "C" fn(Handle, c_double) -> *mut MpvEvent,
    terminate_destroy: unsafe extern "C" fn(Handle),
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
}

static API: OnceLock<Result<Api, String>> = OnceLock::new();

/// Find and load libmpv. We look next to the app first, then let Windows search.
fn load(search_dirs: &[PathBuf]) -> Result<Api, String> {
    let names: &[&str] = if cfg!(windows) {
        &["libmpv-2.dll", "mpv-2.dll", "mpv-1.dll"]
    } else if cfg!(target_os = "macos") {
        &["libmpv.2.dylib", "libmpv.dylib"]
    } else {
        &["libmpv.so.2", "libmpv.so"]
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    for d in search_dirs {
        for n in names {
            candidates.push(d.join(n));
        }
    }
    for n in names {
        candidates.push(PathBuf::from(n));
    }
    let mut last = String::from("libmpv not found");
    for c in candidates {
        match unsafe { Library::new(&c) } {
            Ok(lib) => {
                // Keep the library loaded for the life of the app.
                let lib: &'static Library = Box::leak(Box::new(lib));
                unsafe {
                    macro_rules! sym {
                        ($name:literal) => {
                            *lib.get($name).map_err(|e| format!("libmpv is missing a function: {e}"))?
                        };
                    }
                    return Ok(Api {
                        create: sym!(b"mpv_create\0"),
                        initialize: sym!(b"mpv_initialize\0"),
                        set_option_string: sym!(b"mpv_set_option_string\0"),
                        command: sym!(b"mpv_command\0"),
                        wait_event: sym!(b"mpv_wait_event\0"),
                        terminate_destroy: sym!(b"mpv_terminate_destroy\0"),
                        error_string: sym!(b"mpv_error_string\0"),
                    });
                }
            }
            Err(e) => last = format!("{}: {e}", c.display()),
        }
    }
    Err(format!("Couldn't load the mpv player library ({last})."))
}

fn api(search_dirs: &[PathBuf]) -> Result<&'static Api, String> {
    API.get_or_init(|| load(search_dirs)).as_ref().map_err(|e| e.clone())
}

/// A running mpv instance. `alive` guards the handle so we never send a
/// command to an instance that has already been destroyed.
struct Instance {
    handle: Handle,
    alive: bool,
}
unsafe impl Send for Instance {}

#[derive(Clone)]
pub struct Session(Arc<Mutex<Instance>>);

impl Session {
    pub fn command(&self, args: &[&str]) {
        let inst = self.0.lock().unwrap();
        if !inst.alive {
            return;
        }
        if let Some(Ok(api)) = API.get() {
            let owned: Vec<CString> = args.iter().map(|a| CString::new(*a).unwrap()).collect();
            let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            unsafe { (api.command)(inst.handle, ptrs.as_mut_ptr()) };
        }
    }

    pub fn quit(&self) {
        self.command(&["quit"]);
    }
}

pub struct PlayRequest {
    pub url: String,
    pub title: String,
    pub start_seconds: f64,
}

/// How playback ended, reported back to the UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Ended {
    pub error: Option<String>,
}

/// Start playing. Returns immediately; `on_end` is called from the player thread.
pub fn play(
    search_dirs: &[PathBuf],
    req: PlayRequest,
    on_end: impl FnOnce(Ended) + Send + 'static,
) -> Result<Session, String> {
    let api = api(search_dirs)?;
    let handle = unsafe { (api.create)() };
    if handle.is_null() {
        return Err("mpv failed to start.".into());
    }

    let set = |k: &str, v: &str| {
        let k = CString::new(k).unwrap();
        let v = CString::new(v).unwrap();
        unsafe { (api.set_option_string)(handle, k.as_ptr(), v.as_ptr()) }
    };

    // Behave like the normal mpv player: its own window, on-screen controls,
    // default keyboard shortcuts and Windows media keys.
    set("config", "no");
    set("terminal", "no");
    set("force-window", "yes");
    set("osc", "yes");
    set("input-default-bindings", "yes");
    set("input-vo-keyboard", "yes");
    set("input-media-keys", "yes");
    set("keep-open", "no");
    set("idle", "no");
    set("hwdec", "auto-safe");
    set("vo", "gpu");
    set("autofit", "85%x85%");
    set("title", &req.title);
    set("force-media-title", &req.title);
    set("sub-auto", "fuzzy");
    set("cache", "yes");
    set("demuxer-max-bytes", "150MiB");
    set("user-agent", "Scrappy/mpv");
    if req.start_seconds > 1.0 {
        set("start", &format!("{:.3}", req.start_seconds));
    }

    let rc = unsafe { (api.initialize)(handle) };
    if rc < 0 {
        let msg = unsafe { CStr::from_ptr((api.error_string)(rc)) }.to_string_lossy().to_string();
        unsafe { (api.terminate_destroy)(handle) };
        return Err(format!("mpv failed to initialise: {msg}"));
    }

    let session = Session(Arc::new(Mutex::new(Instance { handle, alive: true })));
    session.command(&["loadfile", &req.url]);

    let thread_session = session.clone();
    std::thread::spawn(move || {
        let handle = thread_session.0.lock().unwrap().handle;
        let mut error = None;
        loop {
            let ev = unsafe { &*(api.wait_event)(handle, -1.0) };
            match ev.event_id {
                EVENT_SHUTDOWN => break,
                EVENT_END_FILE => {
                    if !ev.data.is_null() {
                        let data = unsafe { &*(ev.data as *const MpvEventEndFile) };
                        if data.reason == END_FILE_REASON_ERROR {
                            let msg = unsafe { CStr::from_ptr((api.error_string)(data.error)) }
                                .to_string_lossy()
                                .to_string();
                            error = Some(format!("mpv couldn't play the file: {msg}"));
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
        {
            let mut inst = thread_session.0.lock().unwrap();
            inst.alive = false;
        }
        unsafe { (api.terminate_destroy)(handle) };
        on_end(Ended { error });
    });

    Ok(session)
}
