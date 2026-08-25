//! `shadercc` — compile one WGSL entry point to SPIR-V for SDL_gpu, and report
//! the numbers `SDL_GPUShaderCreateInfo` asks for.
//!
//! SPIR-V and nothing else, on purpose. Naga can also emit MSL and HLSL, but
//! neither comes out in the shape SDL binds — see the README — and SDL ships a
//! tool built for exactly that conversion. So this crate does the one job it
//! can do correctly, and `SDL_shadercross` does the rest, from the SPIR-V this
//! produces.
//!
//! One entry point per run, like shadercross: SDL's descriptor set layout
//! depends on the stage, so a module holding both a vertex and a fragment entry
//! point cannot have one correct set numbering for both.

mod backends;
mod sdl;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use clap::Parser;
use naga::valid::{Capabilities, ValidationFlags, Validator};
use naga::{Module, ShaderStage};

#[derive(Parser, Debug)]
#[command(
    name = "shadercc",
    about = "Compile a WGSL entry point to SPIR-V for SDL_gpu",
    long_about = None,
)]
struct Args {
    /// The WGSL file to compile.
    input: PathBuf,

    /// Entry point to compile. Defaults to the only one in the file.
    #[arg(short, long)]
    entry: Option<String>,

    /// Where to write the `.spv`. Defaults to the input's directory.
    #[arg(short = 'o', long)]
    out_dir: Option<PathBuf>,

    /// Output file stem. Defaults to `<input stem>.<entry point>`.
    #[arg(long)]
    stem: Option<String>,

    /// Negate `@builtin(position).y` in the SPIR-V.
    ///
    /// Off by default: SDL_gpu's Vulkan backend already flips its own viewport,
    /// so emitting the flip too renders the image upside down. Turn it on for a
    /// raw Vulkan renderer that does not flip.
    #[arg(long)]
    flip_y: bool,

    /// Keep Naga's debug annotations in the SPIR-V.
    #[arg(long)]
    debug: bool,

    /// Report the resource layout without writing anything.
    #[arg(long)]
    dry_run: bool,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("shadercc: {err:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args = Args::parse();

    let source = std::fs::read_to_string(&args.input)
        .with_context(|| format!("reading {}", args.input.display()))?;

    // Naga's WGSL errors carry spans, and its own formatter is the only thing
    // that turns them back into a line and a caret.
    let module = naga::front::wgsl::parse_str(&source).map_err(|e| {
        anyhow!(
            "{}",
            e.emit_to_string_with_path(&source, &args.input.display().to_string())
        )
    })?;

    let info = Validator::new(ValidationFlags::all(), Capabilities::all())
        .validate(&module)
        .map_err(|e| {
            anyhow!(
                "{}",
                e.emit_to_string_with_path(&source, &args.input.display().to_string())
            )
        })?;

    let (entry_index, entry_name, stage) = pick_entry_point(&module, args.entry.as_deref())?;

    let resources = sdl::classify(&module, &info, entry_index)?;
    let counts = sdl::Counts::of(&resources);

    report(&entry_name, stage, &resources, &counts);

    if args.dry_run {
        return Ok(());
    }

    let out_dir = args
        .out_dir
        .clone()
        .unwrap_or_else(|| args.input.parent().unwrap_or(Path::new(".")).to_path_buf());
    std::fs::create_dir_all(&out_dir).with_context(|| format!("creating {}", out_dir.display()))?;

    let stem = args.stem.clone().unwrap_or_else(|| {
        let base = args
            .input
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "shader".to_string());
        format!("{base}.{entry_name}")
    });
    let path = out_dir.join(format!("{stem}.spv"));

    let bytes = backends::spirv(
        &module,
        &info,
        &entry_name,
        stage,
        &resources,
        args.flip_y,
        args.debug,
    )?;

    std::fs::write(&path, &bytes).with_context(|| format!("writing {}", path.display()))?;
    println!("wrote {} ({} bytes)", path.display(), bytes.len());

    Ok(())
}

/// Find the entry point to compile: its index, name and declared stage.
///
/// The index is what [`sdl::classify`] needs — `ModuleInfo` keeps its
/// per-entry-point usage tables in the same order as `Module::entry_points`.
fn pick_entry_point(module: &Module, wanted: Option<&str>) -> Result<(usize, String, ShaderStage)> {
    let available: Vec<_> = module
        .entry_points
        .iter()
        .enumerate()
        .map(|(i, ep)| (i, ep.name.clone(), ep.stage))
        .collect();

    if available.is_empty() {
        bail!("this module has no entry points");
    }

    match wanted {
        Some(name) => available
            .iter()
            .find(|(_, n, _)| n == name)
            .cloned()
            .ok_or_else(|| {
                anyhow!(
                    "no entry point named `{name}`; this module has {}",
                    list_entry_points(&available)
                )
            }),
        None if available.len() == 1 => Ok(available[0].clone()),
        None => bail!(
            "this module has {} — name one with --entry",
            list_entry_points(&available)
        ),
    }
}

fn list_entry_points(available: &[(usize, String, ShaderStage)]) -> String {
    available
        .iter()
        .map(|(_, n, s)| format!("`{n}` ({})", stage_name(*s)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn stage_name(stage: ShaderStage) -> &'static str {
    match stage {
        ShaderStage::Vertex => "vertex",
        ShaderStage::Fragment => "fragment",
        ShaderStage::Compute => "compute",
        ShaderStage::Task => "task",
        ShaderStage::Mesh => "mesh",
        // Naga knows the ray tracing stages; SDL_gpu does not have them.
        _ => "ray tracing",
    }
}

/// Print the resource layout and the create-info numbers.
fn report(entry: &str, stage: ShaderStage, resources: &[sdl::Resource], counts: &sdl::Counts) {
    println!("entry point `{entry}` ({})", stage_name(stage));

    if resources.is_empty() {
        println!("  no bound resources");
    } else {
        println!("  resources, in SDL's binding order:");
        for r in resources {
            println!(
                "    @group({}) @binding({})  {:<28} {}",
                r.group,
                r.binding,
                r.kind.label(),
                r.name
            );
        }
    }

    println!();
    if stage == ShaderStage::Compute {
        println!("  SDL_GPUComputePipelineCreateInfo:");
        println!("    num_samplers                   = {}", counts.samplers);
        println!(
            "    num_readonly_storage_textures  = {}",
            counts.readonly_storage_textures
        );
        println!(
            "    num_readonly_storage_buffers   = {}",
            counts.readonly_storage_buffers
        );
        println!(
            "    num_readwrite_storage_textures = {}",
            counts.readwrite_storage_textures
        );
        println!(
            "    num_readwrite_storage_buffers  = {}",
            counts.readwrite_storage_buffers
        );
        println!(
            "    num_uniform_buffers            = {}",
            counts.uniform_buffers
        );
    } else {
        println!("  SDL_GPUShaderCreateInfo:");
        println!("    num_samplers         = {}", counts.samplers);
        println!(
            "    num_storage_textures = {}",
            counts.graphics_storage_textures()
        );
        println!(
            "    num_storage_buffers  = {}",
            counts.graphics_storage_buffers()
        );
        println!("    num_uniform_buffers  = {}", counts.uniform_buffers);
    }
    println!();
}
