//! A small wrapper around libmpv, loaded at runtime from libmpv-2.dll.
//! One mpv instance lives while the player is open; files are loaded into it.

use libloading::Library;
use serde_json::{Map, Value};
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

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
union NodeU {
    string: *mut c_char,
    flag: c_int,
    int64: i64,
    double_: c_double,
    list: *mut NodeList,
}

#[repr(C)]
struct Node {
    u: NodeU,
    format: c_int,
}

#[repr(C)]
struct NodeList {
    num: c_int,
    values: *mut Node,
    keys: *mut *mut c_char,
}

const FORMAT_NODE: c_int = 6;
const FMT_STRING: c_int = 1;
const FMT_FLAG: c_int = 3;
const FMT_INT64: c_int = 4;
const FMT_DOUBLE: c_int = 5;
const FMT_ARRAY: c_int = 7;
const FMT_MAP: c_int = 8;

const EVENT_SHUTDOWN: c_int = 1;
const EVENT_END_FILE: c_int = 7;
const EVENT_FILE_LOADED: c_int = 8;
const EVENT_PROPERTY_CHANGE: c_int = 22;

struct Api {
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    get_property: unsafe extern "C" fn(Handle, *const c_char, c_int, *mut c_void) -> c_int,
    observe_property: unsafe extern "C" fn(Handle, u64, *const c_char, c_int) -> c_int,
    free_node_contents: unsafe extern "C" fn(*mut Node),
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
                        set_property_string: sym!(b"mpv_set_property_string\0"),
                        get_property: sym!(b"mpv_get_property\0"),
                        observe_property: sym!(b"mpv_observe_property\0"),
                        free_node_contents: sym!(b"mpv_free_node_contents\0"),
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

fn err_str(api: &Api, code: c_int) -> String {
    unsafe { CStr::from_ptr((api.error_string)(code)) }.to_string_lossy().to_string()
}

/// Convert an mpv node (mpv's own JSON-like tree) into a serde_json value.
unsafe fn node_to_json(n: &Node) -> Value {
    match n.format {
        FMT_STRING => Value::String(CStr::from_ptr(n.u.string).to_string_lossy().to_string()),
        FMT_FLAG => Value::Bool(n.u.flag != 0),
        FMT_INT64 => Value::from(n.u.int64),
        FMT_DOUBLE => serde_json::Number::from_f64(n.u.double_).map(Value::Number).unwrap_or(Value::Null),
        FMT_ARRAY | FMT_MAP => {
            let list = &*n.u.list;
            let vals = std::slice::from_raw_parts(list.values, list.num.max(0) as usize);
            if n.format == FMT_ARRAY {
                Value::Array(vals.iter().map(|v| node_to_json(v)).collect())
            } else {
                let keys = std::slice::from_raw_parts(list.keys, list.num.max(0) as usize);
                let mut m = Map::new();
                for (k, v) in keys.iter().zip(vals) {
                    m.insert(CStr::from_ptr(*k).to_string_lossy().to_string(), node_to_json(v));
                }
                Value::Object(m)
            }
        }
        _ => Value::Null,
    }
}

pub enum Event {
    /// An observed property changed.
    Property(String, Value),
    /// The file is open and playing.
    FileLoaded,
    /// The current file ended. `eof` is true when it played to the end.
    EndFile { eof: bool, error: Option<String> },
    /// The mpv instance has closed.
    Shutdown,
}

struct Instance {
    handle: Handle,
    alive: bool,
}
unsafe impl Send for Instance {}

#[derive(Clone)]
pub struct Player(Arc<Mutex<Instance>>);

impl Player {
    /// Create an mpv instance with the given options and start its event thread.
    pub fn create(
        search_dirs: &[PathBuf],
        options: &[(&str, String)],
        observe: &[&str],
        on_event: impl Fn(Event) + Send + 'static,
    ) -> Result<Player, String> {
        let api = api(search_dirs)?;
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err("mpv failed to start.".into());
        }
        for (k, v) in options {
            let ck = CString::new(*k).unwrap();
            let cv = CString::new(v.as_str()).unwrap();
            unsafe { (api.set_option_string)(handle, ck.as_ptr(), cv.as_ptr()) };
        }
        let rc = unsafe { (api.initialize)(handle) };
        if rc < 0 {
            unsafe { (api.terminate_destroy)(handle) };
            return Err(format!("mpv failed to initialise: {}", err_str(api, rc)));
        }
        for p in observe {
            let c = CString::new(*p).unwrap();
            unsafe { (api.observe_property)(handle, 0, c.as_ptr(), FORMAT_NODE) };
        }

        let player = Player(Arc::new(Mutex::new(Instance { handle, alive: true })));
        let thread_player = player.clone();
        std::thread::spawn(move || {
            let handle = thread_player.0.lock().unwrap().handle;
            loop {
                let ev = unsafe { &*(api.wait_event)(handle, -1.0) };
                match ev.event_id {
                    EVENT_SHUTDOWN => break,
                    EVENT_FILE_LOADED => on_event(Event::FileLoaded),
                    EVENT_END_FILE => {
                        let (mut eof, mut error) = (false, None);
                        if !ev.data.is_null() {
                            let d = unsafe { &*(ev.data as *const MpvEventEndFile) };
                            eof = d.reason == 0;
                            if d.reason == 4 {
                                error = Some(format!("mpv couldn't play the file: {}", err_str(api, d.error)));
                            }
                        }
                        on_event(Event::EndFile { eof, error });
                    }
                    EVENT_PROPERTY_CHANGE if !ev.data.is_null() => {
                        let p = unsafe { &*(ev.data as *const MpvEventProperty) };
                        let name = unsafe { CStr::from_ptr(p.name) }.to_string_lossy().to_string();
                        let value = if p.format == FORMAT_NODE && !p.data.is_null() {
                            unsafe { node_to_json(&*(p.data as *const Node)) }
                        } else {
                            Value::Null
                        };
                        on_event(Event::Property(name, value));
                    }
                    _ => {}
                }
            }
            thread_player.0.lock().unwrap().alive = false;
            unsafe { (api.terminate_destroy)(handle) };
            on_event(Event::Shutdown);
        });
        Ok(player)
    }

    pub fn alive(&self) -> bool {
        self.0.lock().unwrap().alive
    }

    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let inst = self.0.lock().unwrap();
        if !inst.alive {
            return Err("Player is closed.".into());
        }
        let api = API.get().and_then(|a| a.as_ref().ok()).ok_or("mpv not loaded")?;
        let owned: Vec<CString> = args.iter().map(|a| CString::new(*a).unwrap_or_default()).collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let rc = unsafe { (api.command)(inst.handle, ptrs.as_mut_ptr()) };
        if rc < 0 {
            return Err(err_str(api, rc));
        }
        Ok(())
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let inst = self.0.lock().unwrap();
        if !inst.alive {
            return Err("Player is closed.".into());
        }
        let api = API.get().and_then(|a| a.as_ref().ok()).ok_or("mpv not loaded")?;
        let (n, v) = (CString::new(name).unwrap(), CString::new(value).unwrap_or_default());
        let rc = unsafe { (api.set_property_string)(inst.handle, n.as_ptr(), v.as_ptr()) };
        if rc < 0 {
            return Err(err_str(api, rc));
        }
        Ok(())
    }

    pub fn get_property(&self, name: &str) -> Value {
        let inst = self.0.lock().unwrap();
        if !inst.alive {
            return Value::Null;
        }
        let Some(api) = API.get().and_then(|a| a.as_ref().ok()) else { return Value::Null };
        let n = CString::new(name).unwrap();
        let mut node = Node { u: NodeU { int64: 0 }, format: 0 };
        let rc = unsafe { (api.get_property)(inst.handle, n.as_ptr(), FORMAT_NODE, &mut node as *mut Node as *mut c_void) };
        if rc < 0 {
            return Value::Null;
        }
        let v = unsafe { node_to_json(&node) };
        unsafe { (api.free_node_contents)(&mut node) };
        v
    }

    pub fn quit(&self) {
        let _ = self.command(&["quit"]);
    }
}
