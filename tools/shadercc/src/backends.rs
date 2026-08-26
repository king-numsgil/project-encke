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

use crate::sdl::{self, Resource};

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

    // The placement is `sdl::assign`'s, so that what the report prints is what
    // the bytecode is decorated with. A sampler shares its texture's set *and
    // binding* — SDL declares one `VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER`
    // per texture and no sampler descriptor at all, and Vulkan reaches a
    // combined descriptor through separate image and sampler variables only when
    // both name the same set and binding.
    let mut binding_map = spv::BindingMap::default();
    for placement in sdl::assign(stage, resources)? {
        let r = &resources[placement.resource];
        binding_map.insert(
            naga::ResourceBinding {
                group: r.group,
                binding: r.binding,
            },
            spv::BindingInfo {
                descriptor_set: placement.set,
                binding: placement.binding,
                binding_array_size: None,
            },
        );
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
