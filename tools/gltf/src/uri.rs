// Getting bytes out of a glTF URI.
//
// A `.gltf` file references its buffers and images three ways and a `.glb` adds
// a fourth, so every load has to handle all of them:
//
//   * a **relative path**, percent-encoded, resolved against the document's own
//     directory — `textures/wood_colour.png`;
//   * a **data URI**, base64 or plain — `data:image/png;base64,iVBORw0…`;
//   * a **buffer view** into the GLB's binary chunk, which is not a URI at all
//     and is handled by the caller;
//   * and, for the GLB buffer itself, no URI: `buffer.source()` is `Bin`.
//
// This module owns the first two. It deliberately does **not** fetch anything
// over the network: a `http://` URI is a hard error rather than a download,
// because a renderer that quietly reaches for the internet at load time is a
// renderer that hangs on a train.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use percent_encoding::percent_decode_str;
use std::path::{Path, PathBuf};

/// The bytes a URI names, read or decoded.
///
/// `base` is the directory the document was loaded from. A data URI ignores it;
/// a relative path is joined onto it, which is why loading a `.gltf` from a
/// different working directory than its `.bin` still works.
pub fn resolve(uri: &str, base: &Path) -> Result<Vec<u8>, String> {
    if let Some(rest) = uri.strip_prefix("data:") {
        return decode_data_uri(rest);
    }

    if uri.starts_with("http://") || uri.starts_with("https://") {
        return Err(format!(
            "'{uri}' is a network URI; this loader reads local files only"
        ));
    }

    let path = resolve_path(uri, base);
    std::fs::read(&path).map_err(|error| format!("cannot read '{}': {error}", path.display()))
}

/// The filesystem path a relative URI names, percent-decoding it first.
///
/// A path with a space in it arrives as `my%20model.bin` and opening that
/// literally fails with "file not found", which is a confusing way to be told
/// about an encoding.
pub fn resolve_path(uri: &str, base: &Path) -> PathBuf {
    let decoded = percent_decode_str(uri).decode_utf8_lossy().into_owned();
    base.join(decoded)
}

/// The part of a data URI after `data:`, as bytes.
///
/// The media type is skipped rather than checked. glTF files in the wild label
/// the same base64 blob `application/octet-stream`,
/// `application/gltf-buffer` and occasionally nothing at all, and none of those
/// three tell us anything the caller does not already know from *where* the URI
/// was referenced.
fn decode_data_uri(rest: &str) -> Result<Vec<u8>, String> {
    let Some((meta, payload)) = rest.split_once(',') else {
        return Err("malformed data URI: no comma separating the media type from the payload".into())
    };

    if !meta.split(';').any(|part| part == "base64") {
        // Legal, and vanishingly rare: a percent-encoded payload rather than a
        // base64 one. Handled rather than rejected because handling it is one
        // line and rejecting it would be a puzzling failure on a valid file.
        return Ok(percent_decode_str(payload).collect());
    }

    STANDARD
        .decode(payload)
        .map_err(|error| format!("malformed base64 in a data URI: {error}"))
}
