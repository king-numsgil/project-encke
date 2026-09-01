// encke's glTF loader, as six C functions.
//
// The work is the `gltf` crate's; what this library adds is the shape encke
// wants it in — baked vertex streams in the renderer's own layout, one world
// transform per instance, and images still encoded so SDL3_image can decode
// them. See `scene.rs` for the published structures.
//
// The **order of the entry points matters**, and it is the one thing a caller
// can get wrong that nothing will diagnose for them:
//
//     encke_gltf_set_allocator(...)     // once, before anything else
//     let scene = encke_gltf_load(path) // null on failure
//     ...                               // read it
//     encke_gltf_free(scene)
//
// `set_allocator` first because this library has no heap of its own — it uses
// encke's, so that a block allocated here can be read there and, crucially, so
// that there is one live-allocation story in the process rather than two. See
// `alloc.rs`.

mod alloc;
mod bake;
mod scene;
mod uri;

use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::path::PathBuf;

pub use alloc::{HostAlloc, HostFree, HostRealloc};
pub use scene::{
    EnckeGltfImage, EnckeGltfMaterial, EnckeGltfMesh, EnckeGltfNode, EnckeGltfScene,
};

#[global_allocator]
static GLOBAL: alloc::HostAllocator = alloc::HostAllocator;

// The last failure, per thread — `SDL_GetError`'s contract, and deliberately so,
// since every other error in this program is already reported that way.
//
// The pointer `encke_gltf_last_error` hands back is valid until the next call
// into this library **on the same thread**, and is never null: a library that
// makes you check for null before you can find out what went wrong has made
// error handling harder than the thing that failed.
//
// `None` rather than an empty `CString`, because `CString::default` allocates —
// and this slot has to be readable before the allocator handshake, which is
// precisely the state a caller is in when they most want to be told something.
thread_local! {
    static LAST_ERROR: RefCell<Option<CString>> = const { RefCell::new(None) };
}

/// What `encke_gltf_last_error` returns when there is nothing to report.
static NO_ERROR: &[u8] = b"\0";

fn set_error(message: String) {
    let text = CString::new(message)
        .unwrap_or_else(|_| CString::new("the error message contained a NUL").unwrap());
    LAST_ERROR.with(|slot| *slot.borrow_mut() = Some(text));
}

fn clear_error() {
    LAST_ERROR.with(|slot| *slot.borrow_mut() = None);
}

/// The ABI these declarations describe.
///
/// Bumped whenever a published struct changes shape. `src/bindings/encke_gltf`
/// checks it at startup, because the failure mode of a stale DLL beside a fresh
/// executable is a garbage vertex stream rather than an error, and a garbage
/// vertex stream looks like a renderer bug.
pub const ABI_VERSION: u32 = 1;

#[unsafe(no_mangle)]
pub extern "C" fn encke_gltf_abi_version() -> u32 {
    ABI_VERSION
}

/// Hand this library the host's allocator. Call once, before anything else.
///
/// The three signatures are goblin-forge's `mi_malloc_aligned`,
/// `mi_realloc_aligned` and `mi_free` exactly, so the Goblin side passes the
/// prelude's own function pointers with no adapter in between.
///
/// # Safety
///
/// The three functions must be a matched set from one allocator, must outlive
/// every call into this library, and must be installed before any of them.
/// Allocating before this has run aborts the process rather than guessing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn encke_gltf_set_allocator(
    alloc: HostAlloc,
    realloc: HostRealloc,
    free: HostFree,
) {
    alloc::install(alloc, realloc, free);
}

/// Load a `.gltf` or `.glb`. Null on failure, with the reason in
/// {@link encke_gltf_last_error}.
///
/// The result is owned by this library and released by
/// {@link encke_gltf_free} — every pointer reachable from it dies at the same
/// moment, so a mesh's vertices must be uploaded before the scene is freed.
///
/// # Safety
///
/// `path` must be a NUL-terminated string this call may read.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn encke_gltf_load(path: *const c_char) -> *const EnckeGltfScene {
    if !alloc::installed() {
        // Cannot use `set_error`: recording the message would allocate, which
        // is the very thing that is not yet possible.
        return std::ptr::null();
    }

    clear_error();

    if path.is_null() {
        set_error("encke_gltf_load was given a null path".into());
        return std::ptr::null();
    }

    let text = match unsafe { CStr::from_ptr(path) }.to_str() {
        Ok(text) => text,
        Err(_) => {
            set_error("the path is not valid UTF-8".into());
            return std::ptr::null();
        }
    };

    match scene::load(&PathBuf::from(text)) {
        Ok(owned) => {
            let raw = Box::into_raw(owned);
            // `Owned` is `#[repr(C)]` with the scene first, so the block's
            // address is the scene's address and `encke_gltf_free` can undo
            // this with a cast. See the note on `Owned`.
            raw as *const EnckeGltfScene
        }
        Err(message) => {
            set_error(message);
            std::ptr::null()
        }
    }
}

/// Release a scene from {@link encke_gltf_load}. Null is a no-op, as in C.
///
/// # Safety
///
/// `scene` must have come from `encke_gltf_load` and must not have been freed
/// already. Nothing reachable from it may be read afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn encke_gltf_free(scene: *const EnckeGltfScene) {
    if scene.is_null() {
        return;
    }
    drop(unsafe { Box::from_raw(scene as *mut scene::Owned) });
}

/// Why the last call failed, or `""`. Never null.
///
/// Valid until the next call into this library on this thread.
#[unsafe(no_mangle)]
pub extern "C" fn encke_gltf_last_error() -> *const c_char {
    LAST_ERROR.with(|slot| match slot.borrow().as_ref() {
        Some(text) => text.as_ptr(),
        None => NO_ERROR.as_ptr() as *const c_char,
    })
}
