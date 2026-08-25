//! Naga's SPIR-V back end, configured for SDL_gpu.
//!
//! It is given an explicit binding map rather than being left to pass
//! `@group`/`@binding` through, because SDL's rule is *positional* — "sampled
//! textures, followed by storage textures, followed by storage buffers" — and a
//! position is something this tool can compute from the classified resources.
//! The alternative is asking the shader author to hand-number a layout by hand,
//! which is the kind of thing that works until it does not.

use anyhow::{Context, Result};
use naga::back::spv;
use naga::valid::ModuleInfo;
use naga::{Module, ShaderStage};

use crate::sdl::{self, Resource, ResourceKind};

/// SPIR-V for one entry point, as bytes.
///
/// `flip_y` controls Naga's `ADJUST_COORDINATE_SPACE`, which negates
/// `@builtin(position).y` on the way out. It defaults **off**, and that is not
/// the same choice wgpu makes — the reason is SDL:
///
///   * WGSL's clip space is Y-up; Vulkan's framebuffer space is Y-down. Someone
///     has to flip.
///   * SDL_gpu presents one coordinate system across D3D12, Vulkan and Metal,
///     and its Vulkan backend does the flip itself, in the viewport.
///
/// So emitting the flip as well composes two of them and the image arrives
/// upside down. Confirmed by rendering it, not by reading about it. Turn it
/// back on with `--flip-y` if the SPIR-V is bound for a raw Vulkan renderer
/// that does not flip its own viewport.
pub fn spirv(
    module: &Module,
    info: &ModuleInfo,
    entry: &str,
    stage: ShaderStage,
    resources: &[Resource],
    flip_y: bool,
    debug: bool,
) -> Result<Vec<u8>> {
    let mut flags = spv::WriterFlags::LABEL_VARYINGS;
    if flip_y {
        flags |= spv::WriterFlags::ADJUST_COORDINATE_SPACE;
    }
    if debug {
        flags |= spv::WriterFlags::DEBUG;
    }

    // Descriptor set from the kind and the stage; binding from the position
    // within that set.
    //
    // SPIR-V has one binding number space per set, so the order this walk
    // visits the kinds in is the order SDL will see. It is spelled out rather
    // than taken from the sorted list because samplers have to come *last*:
    // SDL's SPIR-V enumeration is "sampled textures, storage textures, storage
    // buffers" with no sampler slot named, so putting them after keeps the
    // three SDL does name at the indices it names them at. Samplers landing at
    // the end of the set works — see the note in `sdl.rs`.
    use ResourceKind::*;
    const SPIRV_ORDER: [ResourceKind; 7] = [
        SampledTexture,
        ReadOnlyStorageTexture,
        ReadWriteStorageTexture,
        ReadOnlyStorageBuffer,
        ReadWriteStorageBuffer,
        UniformBuffer,
        Sampler,
    ];

    let mut binding_map = spv::BindingMap::default();
    let mut next = std::collections::HashMap::<u32, u32>::new();
    for kind in SPIRV_ORDER {
        for r in resources.iter().filter(|r| r.kind == kind) {
            let set = sdl::descriptor_set(stage, r.kind)?;
            let slot = next.entry(set).or_insert(0);
            binding_map.insert(
                naga::ResourceBinding {
                    group: r.group,
                    binding: r.binding,
                },
                spv::BindingInfo {
                    descriptor_set: set,
                    binding: *slot,
                    binding_array_size: None,
                },
            );
            *slot += 1;
        }
    }

    let options = spv::Options {
        lang_version: (1, 0),
        flags,
        binding_map,
        // Every binding must be real. A fake one would produce SPIR-V that
        // loads and then samples from nothing.
        fake_missing_bindings: false,
        ..spv::Options::default()
    };

    // Restricting to one entry point is what makes the descriptor sets
    // unambiguous: a module holding both a vertex and a fragment entry point
    // would want @group(0) and @group(2) for the same resource.
    let pipeline_options = spv::PipelineOptions {
        shader_stage: stage,
        entry_point: entry.to_string(),
    };

    let words = spv::write_vec(module, info, &options, Some(&pipeline_options))
        .context("SPIR-V generation failed")?;

    let mut bytes = Vec::with_capacity(words.len() * 4);
    for word in words {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    Ok(bytes)
}
