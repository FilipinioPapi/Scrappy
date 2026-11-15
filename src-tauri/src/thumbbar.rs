//! Buttons under Scrappy's taskbar preview on Windows (hover the taskbar icon):
//! Previous · Play/Pause · Next, for music and audiobooks (chapters for a book).
//! The page tells us what's playing (`set_state`); a click calls the handler with
//! "prev", "toggle" or "next", which lib.rs forwards to the page.
//! Everything here runs on the window's own (main) thread.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject, HGDIOBJ};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED, THBF_ENABLED, THBN_CLICKED, THB_FLAGS,
    THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, GetSystemMetrics, RegisterWindowMessageW, HICON, ICONINFO, SM_CXSMICON, WM_COMMAND,
};

pub type Handler = Box<dyn Fn(&'static str) + Send + Sync>;

static HANDLER: Mutex<Option<Handler>> = Mutex::new(None);
static HWND_RAW: AtomicIsize = AtomicIsize::new(0);
static ADDED: AtomicBool = AtomicBool::new(false);
static CREATED_MSG: AtomicU32 = AtomicU32::new(0);
/// (something to control, playing, it's an audiobook)
static STATE: Mutex<(bool, bool, bool)> = Mutex::new((false, false, false));
/// prev, play, pause, next (HICONs kept for the life of the app)
static ICONS: OnceLock<[isize; 4]> = OnceLock::new();

const ID_PREV: u32 = 1;
const ID_TOGGLE: u32 = 2;
const ID_NEXT: u32 = 3;
const SUBCLASS_ID: usize = 0x5C4A_9917;

/// Hook the main window. Call once, on the main thread, after the window exists.
pub fn init(hwnd: isize, handler: Handler) {
    *HANDLER.lock().unwrap() = Some(handler);
    HWND_RAW.store(hwnd, Ordering::Relaxed);
    unsafe {
        CREATED_MSG.store(RegisterWindowMessageW(w!("TaskbarButtonCreated")), Ordering::Relaxed);
        let _ = SetWindowSubclass(HWND(hwnd as *mut _), Some(subclass), SUBCLASS_ID, 0);
    }
    // The taskbar button may already exist (the window was shown before we got here).
    add_buttons();
}

/// What's playing now. Call on the main thread.
pub fn set_state(active: bool, playing: bool, book: bool) {
    let changed = {
        let mut s = STATE.lock().unwrap();
        let n = (active, playing, book);
        let c = *s != n;
        *s = n;
        c
    };
    if changed && ADDED.load(Ordering::Relaxed) {
        if let Some(tb) = taskbar() {
            let hwnd = HWND(HWND_RAW.load(Ordering::Relaxed) as *mut _);
            let _ = unsafe { tb.ThumbBarUpdateButtons(hwnd, &buttons()) };
        }
    }
}

fn taskbar() -> Option<ITaskbarList3> {
    unsafe {
        let tb: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok()?;
        tb.HrInit().ok()?;
        Some(tb)
    }
}

fn add_buttons() {
    let hwnd = HWND_RAW.load(Ordering::Relaxed);
    if hwnd == 0 {
        return;
    }
    if let Some(tb) = taskbar() {
        let ok = unsafe { tb.ThumbBarAddButtons(HWND(hwnd as *mut _), &buttons()) }.is_ok();
        if ok {
            ADDED.store(true, Ordering::Relaxed);
        }
    }
}

fn buttons() -> [THUMBBUTTON; 3] {
    let (active, playing, book) = *STATE.lock().unwrap();
    let ic = icons();
    let flags = if active { THBF_ENABLED } else { THBF_DISABLED };
    let mk = |id: u32, icon: isize, tip: &str| {
        let mut b = THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: id,
            hIcon: HICON(icon as *mut _),
            dwFlags: flags,
            ..Default::default()
        };
        for (i, c) in tip.encode_utf16().take(b.szTip.len() - 1).enumerate() {
            b.szTip[i] = c;
        }
        b
    };
    [
        mk(ID_PREV, ic[0], if book { "Previous chapter" } else { "Previous" }),
        if playing { mk(ID_TOGGLE, ic[2], "Pause") } else { mk(ID_TOGGLE, ic[1], "Play") },
        mk(ID_NEXT, ic[3], if book { "Next chapter" } else { "Next" }),
    ]
}

unsafe extern "system" fn subclass(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    let created = CREATED_MSG.load(Ordering::Relaxed);
    if created != 0 && msg == created {
        // Explorer (re)made our taskbar button: the buttons have to be added again.
        ADDED.store(false, Ordering::Relaxed);
        add_buttons();
    } else if msg == WM_COMMAND && ((wp.0 >> 16) & 0xFFFF) as u32 == THBN_CLICKED {
        let act = match (wp.0 & 0xFFFF) as u32 {
            ID_PREV => Some("prev"),
            ID_TOGGLE => Some("toggle"),
            ID_NEXT => Some("next"),
            _ => None,
        };
        if let Some(act) = act {
            if let Some(h) = HANDLER.lock().unwrap().as_ref() {
                h(act);
            }
            return LRESULT(0);
        }
    }
    DefSubclassProc(hwnd, msg, wp, lp)
}

// ---------- Icons: small white shapes drawn here, sized for the screen's scaling ----------

type Tri = [(f32, f32); 3];
type Rect = (f32, f32, f32, f32);

fn icons() -> [isize; 4] {
    *ICONS.get_or_init(|| {
        let size = unsafe { GetSystemMetrics(SM_CXSMICON) }.clamp(16, 64) as usize;
        // Shapes on a 24-unit grid, the same as the in-app icons.
        let prev = icon(size, &[(6.0, 5.0, 8.0, 19.0)], &[[(20.0, 5.0), (20.0, 19.0), (9.0, 12.0)]]);
        let play = icon(size, &[], &[[(7.0, 4.0), (7.0, 20.0), (20.0, 12.0)]]);
        let pause = icon(size, &[(6.5, 5.0, 10.5, 19.0), (13.5, 5.0, 17.5, 19.0)], &[]);
        let next = icon(size, &[(16.0, 5.0, 18.0, 19.0)], &[[(4.0, 5.0), (4.0, 19.0), (15.0, 12.0)]]);
        [prev, play, pause, next]
    })
}

fn inside_tri(p: (f32, f32), t: &Tri) -> bool {
    let s = |a: (f32, f32), b: (f32, f32)| (p.0 - b.0) * (a.1 - b.1) - (a.0 - b.0) * (p.1 - b.1);
    let d1 = s(t[0], t[1]);
    let d2 = s(t[1], t[2]);
    let d3 = s(t[2], t[0]);
    let neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(neg && pos)
}

fn icon(size: usize, rects: &[Rect], tris: &[Tri]) -> isize {
    const SS: usize = 4; // 4×4 samples per pixel for smooth edges
    let scale = 24.0 / size as f32;
    let mut px = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let mut hit = 0;
            for sy in 0..SS {
                for sx in 0..SS {
                    let p = (
                        (x as f32 + (sx as f32 + 0.5) / SS as f32) * scale,
                        (y as f32 + (sy as f32 + 0.5) / SS as f32) * scale,
                    );
                    let on = rects.iter().any(|r| p.0 >= r.0 && p.0 <= r.2 && p.1 >= r.1 && p.1 <= r.3)
                        || tris.iter().any(|t| inside_tri(p, t));
                    if on {
                        hit += 1;
                    }
                }
            }
            let a = (hit * 255 / (SS * SS)) as u8;
            let i = (y * size + x) * 4;
            // BGRA, white with the coverage as alpha.
            px[i] = 255;
            px[i + 1] = 255;
            px[i + 2] = 255;
            px[i + 3] = a;
        }
    }
    unsafe {
        let color = CreateBitmap(size as i32, size as i32, 1, 32, Some(px.as_ptr() as *const _));
        let mask_bits = vec![0u8; size.div_ceil(16) * 2 * size];
        let mask = CreateBitmap(size as i32, size as i32, 1, 1, Some(mask_bits.as_ptr() as *const _));
        let info = ICONINFO { fIcon: true.into(), xHotspot: 0, yHotspot: 0, hbmMask: mask, hbmColor: color };
        let h = CreateIconIndirect(&info).map(|h| h.0 as isize).unwrap_or(0);
        let _ = DeleteObject(HGDIOBJ(color.0));
        let _ = DeleteObject(HGDIOBJ(mask.0));
        h
    }
}
