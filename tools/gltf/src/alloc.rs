// The host's heap, borrowed.
//
// This crate is a DLL and encke is an executable, so by default there would be
// two allocators in the process: mimalloc, linked into encke by the Goblin
// runtime, and whatever `std` picked for this library. Two allocators are not
// merely wasteful — they are a correctness problem the moment a pointer crosses
// the boundary, because the side that frees a block must be the side that
// allocated it, and neither side can tell by looking.
//
// So this crate has no allocator of its own. `encke_gltf_set_allocator` is
// handed three function pointers out of encke's own mimalloc and every Rust
// allocation in this library goes through them. A `Vec<f32>` built here is a
// mimalloc block; the vertex pointer encke reads is an address in encke's heap;
// and a CString this crate hands over could, in principle, be released by
// either side. It is released here, because one owner is still simpler than a
// rule about which functions are exceptions.
//
// The three signatures are **exactly** what goblin-forge's `std/alloc` exports
// as `mi_malloc_aligned`, `mi_realloc_aligned` and `mi_free`, which is why the
// handshake needs no adapter on the Goblin side: the prelude's own function
// pointers go straight across. That is also the only reason `realloc` takes an
// alignment and no old size — mimalloc reads the block's own header for that,
// where Rust's `GlobalAlloc` had to be told.

use core::alloc::{GlobalAlloc, Layout};
use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::io::Write;
use std::ptr;

/// `mi_malloc_aligned`. `align` is always a power of two — `Layout` promises it.
pub type HostAlloc = unsafe extern "C" fn(size: usize, align: usize) -> *mut u8;

/// `mi_realloc_aligned`. The block's old size is mimalloc's business, not ours.
pub type HostRealloc =
    unsafe extern "C" fn(ptr: *mut u8, size: usize, align: usize) -> *mut u8;

/// `mi_free`. One argument, whatever the alignment was — see `std/alloc`.
pub type HostFree = unsafe extern "C" fn(ptr: *mut u8);

// Stored as raw pointers in atomics rather than in a `static mut Option<…>`.
//
// A `static mut` is a data race the compiler stopped accepting references to in
// edition 2024, and the borrow it needs is exactly the one `GlobalAlloc` would
// take on every allocation. These are written once, before anything allocates,
// and read on every allocation after; an atomic load of a pointer is free on
// every architecture this runs on.
static ALLOC: AtomicPtr<()> = AtomicPtr::new(ptr::null_mut());
static REALLOC: AtomicPtr<()> = AtomicPtr::new(ptr::null_mut());
static FREE: AtomicPtr<()> = AtomicPtr::new(ptr::null_mut());

/// Install the host's allocator. Must happen before any other entry point.
///
/// Idempotent in the only sense that matters: calling it twice with the same
/// three functions changes nothing. Calling it twice with *different* ones
/// would strand every block allocated under the first set, so don't.
pub fn install(alloc: HostAlloc, realloc: HostRealloc, free: HostFree) {
    ALLOC.store(alloc as *mut (), Ordering::Release);
    REALLOC.store(realloc as *mut (), Ordering::Release);
    FREE.store(free as *mut (), Ordering::Release);
}

/// Whether {@link install} has run. The entry points check this before working.
pub fn installed() -> bool {
    !ALLOC.load(Ordering::Acquire).is_null()
}

/// Allocating before the handshake is a wiring bug, and an unrecoverable one.
///
/// Not a panic: unwinding out of `GlobalAlloc` is undefined, and there is no
/// heap to build a panic message on anyway. The re-entry flag is not paranoia —
/// `stderr` allocates a line buffer on first use, which lands straight back
/// here, and a silent stack overflow would be a worse diagnostic than none.
#[cold]
#[inline(never)]
fn no_allocator() -> ! {
    static REPORTING: AtomicBool = AtomicBool::new(false);

    if !REPORTING.swap(true, Ordering::SeqCst) {
        let _ = std::io::stderr().write_all(
            b"encke_gltf: allocated before encke_gltf_set_allocator was called.\n\
              The host must install its allocator before any other entry point.\n",
        );
    }

    std::process::abort()
}

fn host_alloc() -> HostAlloc {
    let raw = ALLOC.load(Ordering::Acquire);
    if raw.is_null() {
        no_allocator();
    }
    // Installed from a `HostAlloc` and never from anything else.
    unsafe { core::mem::transmute::<*mut (), HostAlloc>(raw) }
}

fn host_realloc() -> HostRealloc {
    let raw = REALLOC.load(Ordering::Acquire);
    if raw.is_null() {
        no_allocator();
    }
    unsafe { core::mem::transmute::<*mut (), HostRealloc>(raw) }
}

fn host_free() -> HostFree {
    let raw = FREE.load(Ordering::Acquire);
    if raw.is_null() {
        no_allocator();
    }
    unsafe { core::mem::transmute::<*mut (), HostFree>(raw) }
}

pub struct HostAllocator;

unsafe impl GlobalAlloc for HostAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        unsafe { host_alloc()(layout.size(), layout.align()) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, _layout: Layout) {
        unsafe { host_free()(ptr) }
    }

    /// mimalloc keeps the alignment across the move, so this is one call rather
    /// than the allocate-copy-free the default implementation would do.
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        unsafe { host_realloc()(ptr, new_size, layout.align()) }
    }
}
