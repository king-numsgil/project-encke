//! SDL_gpu's resource binding conventions, applied to a Naga module.
//!
//! SDL does not read reflection out of the bytecode. It assumes the shader was
//! *authored* to a fixed layout, documented on `SDL_CreateGPUShader` and
//! `SDL_CreateGPUComputePipeline`, and it trusts the resource counts you hand
//! it in the create-info. Getting either wrong is a driver-level fault rather
//! than an SDL error, so this module does two things:
//!
//!   * classifies every bound global the way SDL classifies it, and orders them
//!     the way SDL expects, so the SPIR-V back end can be told which descriptor
//!     set and binding each one lands on; and
//!   * counts them, so the create-info can be filled in from the shader rather
//!     than from memory.
//!
//! The back end is given an explicit binding map built from that ordering, so
//! the `@group`/`@binding` numbers in the WGSL are free choices — what matters
//! is the relative order of resources of the same kind, which is what the
//! author controls with `@binding`.

use anyhow::{Result, bail};
use naga::valid::ModuleInfo;
use naga::{AddressSpace, ImageClass, Module, ShaderStage, StorageAccess, TypeInner};

/// The kinds of resource SDL distinguishes, in the order SDL binds them.
///
/// The `Ord` derived from this declaration order is load-bearing: it is exactly
/// the "sampled textures, followed by storage textures, followed by storage
/// buffers" ordering the SDL docs specify.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ResourceKind {
    SampledTexture,
    /// A `sampler` or `sampler_comparison`. SDL pairs these with the sampled
    /// textures by index, so they are counted together with them.
    Sampler,
    ReadOnlyStorageTexture,
    ReadWriteStorageTexture,
    ReadOnlyStorageBuffer,
    ReadWriteStorageBuffer,
    UniformBuffer,
}

impl ResourceKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::SampledTexture => "sampled texture",
            Self::Sampler => "sampler",
            Self::ReadOnlyStorageTexture => "read-only storage texture",
            Self::ReadWriteStorageTexture => "read-write storage texture",
            Self::ReadOnlyStorageBuffer => "read-only storage buffer",
            Self::ReadWriteStorageBuffer => "read-write storage buffer",
            Self::UniformBuffer => "uniform buffer",
        }
    }
}

/// One bound global, classified.
#[derive(Clone, Debug)]
pub struct Resource {
    pub name: String,
    pub kind: ResourceKind,
    /// The `@group` the shader author wrote.
    pub group: u32,
    /// The `@binding` the shader author wrote.
    pub binding: u32,
}

/// The bound globals *one entry point actually uses*, sorted into SDL's order.
///
/// Filtering by use is not an optimisation. A WGSL file holding both a vertex
/// and a fragment entry point declares the globals for both, and SDL's counts
/// are per-shader — handing `SDL_GPUShaderCreateInfo` the whole module's totals
/// would reserve slots the stage never binds.
///
/// Sorting by `(kind, group, binding)` rather than by declaration order means
/// the shader can declare its globals in any order it likes; what matters is
/// that the `@binding` indices within one kind are in the author's intended
/// sequence, which the sort preserves.
pub fn classify(module: &Module, info: &ModuleInfo, entry_index: usize) -> Result<Vec<Resource>> {
    let mut out = Vec::new();
    let uses = info.get_entry_point(entry_index);

    for (handle, var) in module.global_variables.iter() {
        if uses[handle].is_empty() {
            continue;
        }

        let Some(ref binding) = var.binding else {
            // No `@group`/`@binding`: a workgroup, private or push-constant
            // global. Not a bound resource, and not SDL's business.
            continue;
        };

        let kind = match var.space {
            AddressSpace::Uniform => ResourceKind::UniformBuffer,
            AddressSpace::Storage { access } => {
                if access.contains(StorageAccess::STORE) {
                    ResourceKind::ReadWriteStorageBuffer
                } else {
                    ResourceKind::ReadOnlyStorageBuffer
                }
            }
            AddressSpace::Handle => match module.types[var.ty].inner {
                TypeInner::Image { class, .. } => match class {
                    ImageClass::Sampled { .. } | ImageClass::Depth { .. } => {
                        ResourceKind::SampledTexture
                    }
                    ImageClass::Storage { access, .. } => {
                        if access.contains(StorageAccess::STORE) {
                            ResourceKind::ReadWriteStorageTexture
                        } else {
                            ResourceKind::ReadOnlyStorageTexture
                        }
                    }
                    ImageClass::External => bail!(
                        "global `{}` is an external texture, which SDL_gpu has no binding slot for",
                        var.name.as_deref().unwrap_or("<unnamed>")
                    ),
                },
                TypeInner::Sampler { .. } => ResourceKind::Sampler,
                TypeInner::AccelerationStructure { .. } => bail!(
                    "global `{}` is an acceleration structure; SDL_gpu has no ray tracing",
                    var.name.as_deref().unwrap_or("<unnamed>")
                ),
                ref other => bail!(
                    "global `{}` has an unexpected handle type: {other:?}",
                    var.name.as_deref().unwrap_or("<unnamed>")
                ),
            },
            other => bail!(
                "global `{}` lives in the {other:?} address space, which cannot carry a binding",
                var.name.as_deref().unwrap_or("<unnamed>")
            ),
        };

        out.push(Resource {
            name: var.name.clone().unwrap_or_else(|| "<unnamed>".to_string()),
            kind,
            group: binding.group,
            binding: binding.binding,
        });
    }

    out.sort_by_key(|r| (r.kind, r.group, r.binding));
    Ok(out)
}

/// The resource counts `SDL_GPUShaderCreateInfo` and
/// `SDL_GPUComputePipelineCreateInfo` ask for.
///
/// A graphics shader reports `num_storage_textures` and `num_storage_buffers`
/// without distinguishing read-only from read-write — it cannot write to them —
/// so the graphics fields fold the two together and the compute fields keep
/// them apart.
#[derive(Clone, Debug, Default)]
pub struct Counts {
    pub samplers: u32,
    pub sampled_textures: u32,
    pub readonly_storage_textures: u32,
    pub readwrite_storage_textures: u32,
    pub readonly_storage_buffers: u32,
    pub readwrite_storage_buffers: u32,
    pub uniform_buffers: u32,
}

impl Counts {
    pub fn of(resources: &[Resource]) -> Self {
        let mut c = Self::default();
        for r in resources {
            let slot = match r.kind {
                ResourceKind::SampledTexture => &mut c.sampled_textures,
                ResourceKind::Sampler => &mut c.samplers,
                ResourceKind::ReadOnlyStorageTexture => &mut c.readonly_storage_textures,
                ResourceKind::ReadWriteStorageTexture => &mut c.readwrite_storage_textures,
                ResourceKind::ReadOnlyStorageBuffer => &mut c.readonly_storage_buffers,
                ResourceKind::ReadWriteStorageBuffer => &mut c.readwrite_storage_buffers,
                ResourceKind::UniformBuffer => &mut c.uniform_buffers,
            };
            *slot += 1;
        }
        c
    }

    /// `num_samplers`, for either create-info.
    ///
    /// SDL counts *texture-sampler pairs*, not sampler objects — each one is a
    /// single `VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER` — so the number it
    /// wants is how many sampled textures the entry point binds. Reporting the
    /// sampler count instead agrees only when every texture has exactly one, and
    /// disagrees silently otherwise: a `textureLoad` on a texture with no
    /// sampler would under-report by one and shift every storage binding in the
    /// set down by one along with it.
    pub fn sdl_samplers(&self) -> u32 {
        self.sampled_textures
    }

    /// `SDL_GPUShaderCreateInfo.num_storage_textures`.
    pub fn graphics_storage_textures(&self) -> u32 {
        self.readonly_storage_textures + self.readwrite_storage_textures
    }

    /// `SDL_GPUShaderCreateInfo.num_storage_buffers`.
    pub fn graphics_storage_buffers(&self) -> u32 {
        self.readonly_storage_buffers + self.readwrite_storage_buffers
    }
}

/// Where one resource actually lands: the descriptor set and binding the
/// SPIR-V is decorated with.
#[derive(Copy, Clone, Debug)]
pub struct Placement {
    /// Index into the slice passed to [`assign`].
    pub resource: usize,
    pub set: u32,
    pub binding: u32,
}

/// Assign every resource its SDL descriptor set and binding.
///
/// One function, used by both the SPIR-V back end and the report, so that what
/// is printed is what is emitted. They were separate once and the printed
/// columns were the author's own `@group`/`@binding` under a heading claiming
/// they were SDL's — which is a good way to not notice a wrong layout.
///
/// Samplers are placed last and *onto* a texture's slot rather than after it;
/// the long version of why is the note at the bottom of this file.
pub fn assign(stage: ShaderStage, resources: &[Resource]) -> Result<Vec<Placement>> {
    use ResourceKind::*;

    // SPIR-V has one binding number space per set, so the order this walk visits
    // the kinds in is the order SDL will see them in.
    const ORDER: [ResourceKind; 6] = [
        SampledTexture,
        ReadOnlyStorageTexture,
        ReadWriteStorageTexture,
        ReadOnlyStorageBuffer,
        ReadWriteStorageBuffer,
        UniformBuffer,
    ];

    let mut out: Vec<Placement> = Vec::with_capacity(resources.len());
    let mut next = std::collections::HashMap::<u32, u32>::new();
    let mut texture_slots: Vec<Placement> = Vec::new();

    for kind in ORDER {
        for (index, r) in resources.iter().enumerate().filter(|(_, r)| r.kind == kind) {
            let set = descriptor_set(stage, r.kind)?;
            let slot = next.entry(set).or_insert(0);
            let placement = Placement {
                resource: index,
                set,
                binding: *slot,
            };

            if kind == SampledTexture {
                texture_slots.push(placement);
            }
            out.push(placement);
            *slot += 1;
        }
    }

    let samplers: Vec<usize> = resources
        .iter()
        .enumerate()
        .filter(|(_, r)| r.kind == Sampler)
        .map(|(i, _)| i)
        .collect();

    if samplers.len() > texture_slots.len() {
        bail!(
            "this entry point binds {} sampler(s) but only {} sampled texture(s); \
             SDL has one combined slot per texture, so a sampler with no texture \
             to pair with has nowhere to go",
            samplers.len(),
            texture_slots.len()
        );
    }

    for (rank, index) in samplers.into_iter().enumerate() {
        out.push(Placement {
            resource: index,
            set: texture_slots[rank].set,
            binding: texture_slots[rank].binding,
        });
    }

    Ok(out)
}

/// The descriptor set SDL expects a resource of this kind to be in, for a
/// SPIR-V shader used from this stage.
///
/// This is the table in the `SDL_CreateGPUShader` and
/// `SDL_CreateGPUComputePipeline` documentation, in code.
pub fn descriptor_set(stage: ShaderStage, kind: ResourceKind) -> Result<u32> {
    use ResourceKind::*;
    Ok(match (stage, kind) {
        // Vertex: set 0 for everything sampled or storage, set 1 for uniforms.
        (ShaderStage::Vertex, UniformBuffer) => 1,
        (ShaderStage::Vertex, _) => 0,

        // Fragment: the same two, shifted up by two.
        (ShaderStage::Fragment, UniformBuffer) => 3,
        (ShaderStage::Fragment, _) => 2,

        // Compute splits read-only from read-write, and puts uniforms third.
        (ShaderStage::Compute, UniformBuffer) => 2,
        (ShaderStage::Compute, ReadWriteStorageTexture | ReadWriteStorageBuffer) => 1,
        (ShaderStage::Compute, _) => 0,

        // Task, mesh and the ray tracing stages have no SDL_gpu equivalent.
        (other, _) => bail!("the {other:?} stage has no SDL_gpu descriptor set layout"),
    })
}

// A note on samplers in SPIR-V, since SDL's docs do not answer the question and
// this is where someone would come looking.
//
// SDL's SPIR-V section lists "sampled textures, followed by storage textures,
// followed by storage buffers" and never mentions samplers at all. The reason is
// that there is nothing to mention: the Vulkan backend declares each texture
// slot as a single `VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER` and emits no
// sampler descriptor anywhere. `SDL_gpu_vulkan.c` builds every "category 1" set
// as three consecutive runs —
//
//     [0, samplerCount)                          COMBINED_IMAGE_SAMPLER
//     [samplerCount, +storageTextureCount)       SAMPLED_IMAGE
//     [.., +storageBufferCount)                  STORAGE_BUFFER
//
// — and `samplerCount` is `num_samplers` from the create-info.
//
// WGSL's model is separate: a `texture_2d<f32>` and a `sampler` are two globals
// and Naga emits two variables. Vulkan allows precisely this against a combined
// descriptor, on one condition — both variables must carry the *same* descriptor
// set and the *same* binding number. That is what `backends.rs` now does, and it
// is why `Sampler` is absent from its binding order rather than last in it.
//
// This file used to claim the question had been settled empirically by the
// checkerboard test in `triangle.wgsl`. It had not. That shader binds one
// sampled texture, one sampler and no storage resources, and under those
// conditions the correct layout and the incorrect one put the *texture* at the
// same binding — so the image sampled correctly either way and the sampler was
// reading a descriptor outside SDL's layout, which NVIDIA tolerates. Any shader
// with two textures, or with one texture beside a storage buffer, would have
// shown it.

