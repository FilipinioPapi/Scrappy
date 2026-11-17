//! Scrappy's taskbar preview on Windows (hover the taskbar icon).
//! - Up to 7 buttons under the preview. The page decides which (music: Favourite, Shuffle,
//!   Previous, Play/Pause, Next, Repeat, Open Now playing; books: chapters and jumps) and draws
//!   their icons itself (`set_icons`), so they match the app and can show numbers (15, 30).
//!   A click calls the handler with the button's action name, which lib.rs forwards to the page.
//! - A progress bar on the taskbar icon (`set_progress`): green playing, yellow paused.
//! - The cover as the preview picture while music or a book plays (`set_cover`).
//! Everything here runs on the window's own (main) thread.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::Mutex;
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmInvalidateIconicBitmaps, DwmSetIconicThumbnail, DwmSetWindowAttribute, DWMWA_DISALLOW_PEEK,
    DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP,
};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, TBPF_NOPROGRESS, TBPF_NORMAL, TBPF_PAUSED,
    THBF_DISABLED, THBF_ENABLED, THBF_HIDDEN, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, DestroyIcon, GetSystemMetrics, RegisterWindowMessageW, HICON, ICONINFO, SM_CXSMICON,
    WM_COMMAND,
};

pub type Handler = Box<dyn Fn(String) + Send + Sync>;

/// One button slot, as the page describes it.
#[derive(Clone, PartialEq, Debug)]
pub struct Btn {
    pub act: String,
    pub icon: String,
    pub tip: String,
    pub enabled: bool,
    pub hidden: bool,
}

const SLOTS: usize = 7; // the most Windows allows; added once, then shown or hidden
const SUBCLASS_ID: usize = 0x5C4A_9917;
const WM_DWMSENDICONICTHUMBNAIL: u32 = 0x0323;

static HANDLER: Mutex<Option<Handler>> = Mutex::new(None);
static HWND_RAW: AtomicIsize = AtomicIsize::new(0);
static ADDED: AtomicBool = AtomicBool::new(false);
static CREATED_MSG: AtomicU32 = AtomicU32::new(0);
static BTNS: Mutex<Vec<Btn>> = Mutex::new(Vec::new());
/// Icon name -> HICON, kept for the life of the app (replaced ones are destroyed).
static ICONS: Mutex<Option<HashMap<String, isize>>> = Mutex::new(None);
/// (state 0 none / 1 playing / 2 paused, value out of 1000)
static PROGRESS: Mutex<(u8, u32)> = Mutex::new((0, 0));
/// Cover picture: width, height, RGBA.
static COVER: Mutex<Option<(u32, u32, Vec<u8>)>> = Mutex::new(None);

fn hwnd() -> HWND {
    HWND(HWND_RAW.load(Ordering::Relaxed) as *mut _)
}

/// Hook the main window. Call once, on the main thread, after the window exists.
pub fn init(hwnd_raw: isize, handler: Handler) {
    *HANDLER.lock().unwrap() = Some(handler);
    HWND_RAW.store(hwnd_raw, Ordering::Relaxed);
    {
        // Until the page says otherwise: Previous · Play · Next, greyed out.
        let mut b = BTNS.lock().unwrap();
        if b.is_empty() {
            let mk = |act: &str, icon: &str, tip: &str, hidden: bool| Btn {
                act: act.into(),
                icon: icon.into(),
                tip: tip.into(),
                enabled: false,
                hidden,
            };
            *b = vec![
                mk("prev", "prev", "Previous", false),
                mk("toggle", "play", "Play", false),
                mk("next", "next", "Next", false),
                mk("", "", "", true),
                mk("", "", "", true),
                mk("", "", "", true),
                mk("", "", "", true),
            ];
        }
    }
    unsafe {
        CREATED_MSG.store(RegisterWindowMessageW(w!("TaskbarButtonCreated")), Ordering::Relaxed);
        let _ = SetWindowSubclass(hwnd(), Some(subclass), SUBCLASS_ID, 0);
    }
    // The taskbar button may already exist (the window was shown before we got here).
    add_buttons();
}

/// Size in pixels the page should draw icons at (the small-icon size for this screen's scaling).
pub fn icon_size() -> u32 {
    unsafe { GetSystemMetrics(SM_CXSMICON) }.clamp(16, 64) as u32
}

/// Icons drawn by the page: name -> RGBA pixels, `size` x `size`.
pub fn set_icons(size: u32, icons: Vec<(String, Vec<u8>)>) {
    let mut old = Vec::new();
    {
        let mut g = ICONS.lock().unwrap();
        let map = g.get_or_insert_with(builtin_icons);
        for (name, rgba) in icons {
            if rgba.len() != (size * size * 4) as usize {
                continue;
            }
            let h = icon_from_rgba(size as usize, &rgba);
            if h == 0 {
                continue;
            }
            if let Some(prev) = map.insert(name, h) {
                old.push(prev);
            }
        }
    }
    update_buttons();
    for h in old {
        unsafe {
            let _ = DestroyIcon(HICON(h as *mut _));
        }
    }
}

/// The buttons to show (up to 7; missing slots are hidden).
pub fn set_buttons(mut btns: Vec<Btn>) {
    btns.truncate(SLOTS);
    while btns.len() < SLOTS {
        btns.push(Btn { act: String::new(), icon: String::new(), tip: String::new(), enabled: false, hidden: true });
    }
    let changed = {
        let mut b = BTNS.lock().unwrap();
        let c = *b != btns;
        *b = btns;
        c
    };
    if changed {
        update_buttons();
    }
}

/// Progress bar on the taskbar icon: state 0 = none, 1 = playing (green), 2 = paused (yellow).
pub fn set_progress(state: u8, value: u32) {
    let value = value.min(1000);
    {
        let mut p = PROGRESS.lock().unwrap();
        if *p == (state, value) {
            return;
        }
        *p = (state, value);
    }
    apply_progress();
}

fn apply_progress() {
    let (state, value) = *PROGRESS.lock().unwrap();
    if HWND_RAW.load(Ordering::Relaxed) == 0 {
        return;
    }
    if let Some(tb) = taskbar() {
        unsafe {
            match state {
                0 => {
                    let _ = tb.SetProgressState(hwnd(), TBPF_NOPROGRESS);
                }
                s => {
                    let _ = tb.SetProgressValue(hwnd(), value as u64, 1000);
                    let _ = tb.SetProgressState(hwnd(), if s == 2 { TBPF_PAUSED } else { TBPF_NORMAL });
                }
            }
        }
    }
}

/// The preview picture: the cover (RGBA), or None for the normal tiny copy of the window.
pub fn set_cover(img: Option<(u32, u32, Vec<u8>)>) {
    let img = img.filter(|(w, h, px)| *w > 0 && *h > 0 && px.len() == (*w * *h * 4) as usize);
    let on = img.is_some();
    *COVER.lock().unwrap() = img;
    if HWND_RAW.load(Ordering::Relaxed) == 0 {
        return;
    }
    let v = BOOL::from(on);
    let p = &v as *const BOOL as *const _;
    let n = std::mem::size_of::<BOOL>() as u32;
    unsafe {
        let _ = DwmSetWindowAttribute(hwnd(), DWMWA_HAS_ICONIC_BITMAP, p, n);
        let _ = DwmSetWindowAttribute(hwnd(), DWMWA_FORCE_ICONIC_REPRESENTATION, p, n);
        // Peek (the whole screen fading to the window when the preview is hovered) would show
        // nothing useful with a cover, and gets in the way of the buttons.
        let _ = DwmSetWindowAttribute(hwnd(), DWMWA_DISALLOW_PEEK, p, n);
        if on {
            let _ = DwmInvalidateIconicBitmaps(hwnd());
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
    if HWND_RAW.load(Ordering::Relaxed) == 0 {
        return;
    }
    if let Some(tb) = taskbar() {
        let ok = unsafe { tb.ThumbBarAddButtons(hwnd(), &buttons()) }.is_ok();
        if ok {
            ADDED.store(true, Ordering::Relaxed);
        }
    }
}

fn update_buttons() {
    if !ADDED.load(Ordering::Relaxed) {
        return;
    }
    if let Some(tb) = taskbar() {
        let _ = unsafe { tb.ThumbBarUpdateButtons(hwnd(), &buttons()) };
    }
}

fn buttons() -> [THUMBBUTTON; SLOTS] {
    let b = BTNS.lock().unwrap().clone();
    let mut g = ICONS.lock().unwrap();
    let map = g.get_or_insert_with(builtin_icons);
    std::array::from_fn(|i| {
        let s = b.get(i);
        let icon = s.and_then(|s| map.get(&s.icon)).copied().unwrap_or(0);
        let hidden = s.map(|s| s.hidden).unwrap_or(true) || icon == 0;
        let enabled = s.map(|s| s.enabled).unwrap_or(false);
        let mut t = THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: i as u32 + 1,
            hIcon: HICON(icon as *mut _),
            dwFlags: if hidden {
                THBF_HIDDEN
            } else if enabled {
                THBF_ENABLED
            } else {
                THBF_DISABLED
            },
            ..Default::default()
        };
        if let Some(s) = s {
            for (k, c) in s.tip.encode_utf16().take(t.szTip.len() - 1).enumerate() {
                t.szTip[k] = c;
            }
        }
        t
    })
}

unsafe extern "system" fn subclass(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    let created = CREATED_MSG.load(Ordering::Relaxed);
    if created != 0 && msg == created {
        // Explorer (re)made our taskbar button: buttons, progress and picture have to be set again.
        ADDED.store(false, Ordering::Relaxed);
        add_buttons();
        apply_progress();
        let cover = COVER.lock().unwrap().clone();
        set_cover(cover);
    } else if msg == WM_COMMAND && ((wp.0 >> 16) & 0xFFFF) as u32 == THBN_CLICKED {
        let slot = (wp.0 & 0xFFFF) as usize;
        let act = BTNS.lock().unwrap().get(slot.wrapping_sub(1)).map(|b| b.act.clone()).unwrap_or_default();
        if !act.is_empty() {
            if let Some(h) = HANDLER.lock().unwrap().as_ref() {
                h(act);
            }
            return LRESULT(0);
        }
    } else if msg == WM_DWMSENDICONICTHUMBNAIL {
        let maxw = ((lp.0 >> 16) & 0xFFFF) as u32;
        let maxh = (lp.0 & 0xFFFF) as u32;
        if send_cover(hwnd, maxw, maxh) {
            return LRESULT(0);
        }
    }
    DefSubclassProc(hwnd, msg, wp, lp)
}

/// Draw the cover centred on a dark background, at the size Windows asked for.
fn send_cover(hwnd: HWND, maxw: u32, maxh: u32) -> bool {
    let guard = COVER.lock().unwrap();
    let Some((cw, ch, px)) = guard.as_ref() else { return false };
    let (cw, ch) = (*cw as f32, *ch as f32);
    let (w, h) = (maxw.clamp(16, 1024) as usize, maxh.clamp(16, 1024) as usize);
    let s = (w as f32 / cw).min(h as f32 / ch);
    let (dw, dh) = ((cw * s).round().max(1.0) as usize, (ch * s).round().max(1.0) as usize);
    let (ox, oy) = ((w - dw.min(w)) / 2, (h - dh.min(h)) / 2);
    unsafe {
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let Ok(hbmp) = CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0) else { return false };
        if bits.is_null() {
            let _ = DeleteObject(HGDIOBJ(hbmp.0));
            return false;
        }
        let out = std::slice::from_raw_parts_mut(bits as *mut u8, w * h * 4);
        for p in out.chunks_exact_mut(4) {
            p.copy_from_slice(&[13, 13, 13, 255]); // BGRA
        }
        let (iw, ih) = (cw as usize, ch as usize);
        for y in 0..dh.min(h) {
            let sy = ((y as f32 + 0.5) / s - 0.5).clamp(0.0, ch - 1.0);
            let (y0, fy) = (sy.floor() as usize, sy.fract());
            let y1 = (y0 + 1).min(ih - 1);
            for x in 0..dw.min(w) {
                let sx = ((x as f32 + 0.5) / s - 0.5).clamp(0.0, cw - 1.0);
                let (x0, fx) = (sx.floor() as usize, sx.fract());
                let x1 = (x0 + 1).min(iw - 1);
                let o = ((oy + y) * w + ox + x) * 4;
                for c in 0..3 {
                    let g = |xx: usize, yy: usize| px[(yy * iw + xx) * 4 + c] as f32;
                    let top = g(x0, y0) * (1.0 - fx) + g(x1, y0) * fx;
                    let bot = g(x0, y1) * (1.0 - fx) + g(x1, y1) * fx;
                    let v = top * (1.0 - fy) + bot * fy;
                    // RGBA in, BGRA out; the cover is opaque, drawn over the dark background
                    out[o + (2 - c)] = v.round().clamp(0.0, 255.0) as u8;
                }
                out[o + 3] = 255;
            }
        }
        let ok = DwmSetIconicThumbnail(hwnd, hbmp, 0).is_ok();
        let _ = DeleteObject(HGDIOBJ(hbmp.0));
        ok
    }
}

// ---------- Icons ----------

fn icon_from_rgba(size: usize, rgba: &[u8]) -> isize {
    let mut px = rgba.to_vec();
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2); // RGBA -> BGRA
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

// Fallback icons drawn here (Previous, Play, Pause, Next), used until the page sends its own.
type Tri = [(f32, f32); 3];
type Rect = (f32, f32, f32, f32);

fn builtin_icons() -> HashMap<String, isize> {
    let size = icon_size() as usize;
    let mut m = HashMap::new();
    m.insert("prev".into(), shape_icon(size, &[(6.0, 5.0, 8.0, 19.0)], &[[(20.0, 5.0), (20.0, 19.0), (9.0, 12.0)]]));
    m.insert("play".into(), shape_icon(size, &[], &[[(7.0, 4.0), (7.0, 20.0), (20.0, 12.0)]]));
    m.insert("pause".into(), shape_icon(size, &[(6.5, 5.0, 10.5, 19.0), (13.5, 5.0, 17.5, 19.0)], &[]));
    m.insert("next".into(), shape_icon(size, &[(16.0, 5.0, 18.0, 19.0)], &[[(4.0, 5.0), (4.0, 19.0), (15.0, 12.0)]]));
    m
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

fn shape_icon(size: usize, rects: &[Rect], tris: &[Tri]) -> isize {
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
            let i = (y * size + x) * 4;
            px[i..i + 4].copy_from_slice(&[255, 255, 255, (hit * 255 / (SS * SS)) as u8]);
        }
    }
    icon_from_rgba(size, &px)
}

/// Standard base64 (the page sends pixels this way).
pub fn b64(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => continue,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    out
}
