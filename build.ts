import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { compile, formatAll, systemLib } from "goblin-forge";

// ---------------------------------------------------------------------------
// Shaders.
//
// Three problems the WGSL toolchain does not solve on its own, all solved here
// rather than in `tools/shadercc`:
//
//   1. **WGSL has no `#include`.** Naga implements the language and the language
//      has no preprocessor, so the PBR BRDF and the cluster indexing arithmetic
//      would have to be pasted into every shader that needs them. `//!include`
//      below is a textual expansion, done before shadercc sees the file.
//   2. **shadercc compiles one entry point per run** and the entry points are
//      in the shader. Rather than a hand-maintained list in this file that goes
//      stale the first time someone adds a `@compute` function, the entry points
//      are *found* in the source.
//   3. **SDL takes the resource counts on trust.** A shader declaring a sampler
//      whose create-info does not mention it gets no descriptor and samples
//      zeroes, silently — shadercc's README calls it a morning gone. shadercc
//      prints those counts for humans; this parses them back out and generates
//      `src/renderer/shaders.generated.ts`, so the numbers cannot drift from the
//      shader they describe.
// ---------------------------------------------------------------------------

const SHADER_DIR = "shaders";
const INCLUDE_DIR = "shaders/include";
const GEN_WGSL_DIR = "shaders/out/gen";
const SPV_DIR = "shaders/out";
const MANIFEST = "src/renderer/shaders.generated.ts";

const SHADERCC = ["cargo", "run", "--quiet", "--release", "--manifest-path", "tools/shadercc/Cargo.toml", "--"];

type Stage = "vertex" | "fragment" | "compute";

interface EntryPoint {
    /** The shader file's stem, e.g. `forward`. */
    readonly module: string;
    /** The WGSL function name, e.g. `fs_main`. */
    readonly name: string;
    readonly stage: Stage;
    /** `@workgroup_size`, for a compute entry point. SDL wants it in the create-info. */
    readonly threads: readonly [number, number, number];
}

interface Counts {
    samplers: number;
    storageTextures: number;
    storageBuffers: number;
    readonlyStorageTextures: number;
    readonlyStorageBuffers: number;
    readwriteStorageTextures: number;
    readwriteStorageBuffers: number;
    uniformBuffers: number;
}

/**
 * Expand `//!include "name.wgsl"` against `shaders/include`, recursively.
 *
 * A file already pulled in is skipped rather than pasted twice — WGSL has no
 * redeclaration and two copies of `struct Light` is a parse error, so this is
 * the `#pragma once` the language does not have.
 */
async function expandIncludes(source: string, seen: Set<string>): Promise<string> {
    const lines = source.split("\n");
    const out: string[] = [];

    for (const line of lines) {
        const match = /^\s*\/\/!include\s+"([^"]+)"\s*$/.exec(line);
        if (match === null) {
            out.push(line);
            continue;
        }

        const name = match[1]!;
        if (seen.has(name)) {
            out.push(`// (${name} already included)`);
            continue;
        }
        seen.add(name);

        const path = join(INCLUDE_DIR, name);
        const text = await readFile(path, "utf8");
        out.push(`// ---- begin ${name} ----`);
        out.push(await expandIncludes(text, seen));
        out.push(`// ---- end ${name} ----`);
    }

    return out.join("\n");
}

/**
 * Find every entry point in an expanded shader.
 *
 * The stage attribute and the `fn` may sit on one line or two, which is why
 * this looks for the attribute and then for the next `fn`, rather than trying
 * to match both in one pattern.
 */
function findEntryPoints(module: string, source: string): EntryPoint[] {
    const found: EntryPoint[] = [];
    const pattern = /@(vertex|fragment|compute)\b([\s\S]*?)\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

    for (const match of source.matchAll(pattern)) {
        const stage = match[1] as Stage;
        const between = match[2]!;
        const name = match[3]!;

        // Anything other than attributes between `@compute` and `fn` means the
        // pattern ran past the end of one declaration into another.
        if (/[;{}]/.test(between)) {
            continue;
        }

        let threads: readonly [number, number, number] = [1, 1, 1];
        if (stage === "compute") {
            const size = /@workgroup_size\s*\(([^)]*)\)/.exec(between);
            if (size === null) {
                throw new Error(`${module}.wgsl: \`${name}\` is @compute with no @workgroup_size`);
            }
            const parts = size[1]!.split(",").map((p) => Number(p.trim()));
            if (parts.some((p) => !Number.isInteger(p) || p < 1)) {
                throw new Error(
                    `${module}.wgsl: \`${name}\` has a @workgroup_size this build cannot read literally ` +
                        `(${size[1]!.trim()}) — SDL needs the numbers up front, so spell them as literals`,
                );
            }
            threads = [parts[0] ?? 1, parts[1] ?? 1, parts[2] ?? 1];
        }

        found.push({ module, name, stage, threads });
    }

    return found;
}

/** Pull the create-info numbers back out of shadercc's report. */
function parseCounts(report: string): Counts {
    const number = (label: string): number => {
        const match = new RegExp(`${label}\\s*=\\s*(\\d+)`).exec(report);
        return match === null ? 0 : Number(match[1]);
    };

    return {
        samplers: number("num_samplers"),
        storageTextures: number("num_storage_textures"),
        storageBuffers: number("num_storage_buffers"),
        readonlyStorageTextures: number("num_readonly_storage_textures"),
        readonlyStorageBuffers: number("num_readonly_storage_buffers"),
        readwriteStorageTextures: number("num_readwrite_storage_textures"),
        readwriteStorageBuffers: number("num_readwrite_storage_buffers"),
        uniformBuffers: number("num_uniform_buffers"),
    };
}

/** `cluster_cull` + `cs_main` -> `clusterCullCsMain`, the generated function's name. */
function functionName(module: string, entry: string): string {
    const camel = (text: string, upperFirst: boolean): string =>
        text
            .split(/[_\-.]/)
            .filter((part) => part.length > 0)
            .map((part, index) =>
                index === 0 && !upperFirst ? part : part.charAt(0).toUpperCase() + part.slice(1),
            )
            .join("");

    return camel(module, false) + camel(entry, true);
}

async function buildShaders(): Promise<void> {
    await mkdir(GEN_WGSL_DIR, { recursive: true });
    await mkdir(dirname(MANIFEST), { recursive: true });

    const files = (await readdir(SHADER_DIR, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith(".wgsl"))
        .map((e) => e.name)
        .sort();

    const compiled: { entry: EntryPoint; counts: Counts }[] = [];

    for (const file of files) {
        const module = file.slice(0, -".wgsl".length);
        const source = await expandIncludes(await readFile(join(SHADER_DIR, file), "utf8"), new Set());
        const expanded = join(GEN_WGSL_DIR, file);
        await writeFile(expanded, source);

        const entries = findEntryPoints(module, source);
        if (entries.length === 0) {
            throw new Error(`${file}: no entry points — move it to ${INCLUDE_DIR} if it is a library`);
        }

        for (const entry of entries) {
            const stem = `${module}.${entry.name}`;
            const result = await Bun.$`${SHADERCC} ${expanded} -e ${entry.name} -o ${SPV_DIR} --stem ${stem}`
                .quiet()
                .nothrow();

            if (result.exitCode !== 0) {
                console.error(result.stderr.toString());
                console.error(result.stdout.toString());
                throw new Error(`shadercc failed on ${file} :: ${entry.name}`);
            }

            compiled.push({ entry, counts: parseCounts(result.stdout.toString()) });
        }
    }

    await writeFile(MANIFEST, renderManifest(compiled));
    console.log(`shaders: ${compiled.length} entry points, manifest -> ${MANIFEST}`);
}

/**
 * Emit the manifest.
 *
 * One function per entry point, each of which *creates* the SDL object rather
 * than describing it. Handing back a description would put the counts in a
 * struct somebody still has to copy into a create-info; handing back the
 * created object means the numbers are used exactly where they were generated
 * and there is no second place for them to be wrong.
 */
function renderManifest(compiled: readonly { entry: EntryPoint; counts: Counts }[]): string {
    const lines: string[] = [
        "// Generated by build.ts. Do not edit.",
        "//",
        "// One function per WGSL entry point. The resource counts are shadercc's own",
        "// report, parsed back out of it, so they cannot drift from the shader — SDL",
        "// takes these on trust and a wrong one samples zeroes with no error anywhere.",
        "",
        'import { SDL_GPUShaderStage } from "../bindings/SDL3/index.ts";',
        'import type { SDL_GPUComputePipeline, SDL_GPUDevice, SDL_GPUShader } from "../bindings/SDL3/index.ts";',
        'import { loadComputePipeline, loadShader } from "./shader.ts";',
        "",
    ];

    for (const { entry, counts } of compiled) {
        const name = functionName(entry.module, entry.name);
        const path = `${SPV_DIR}/${entry.module}.${entry.name}.spv`;

        if (entry.stage === "compute") {
            lines.push(
                `/** \`${entry.module}.wgsl\` :: \`${entry.name}\` — compute, ${entry.threads.join("x")}. */`,
                `export function ${name}(device: Pointer<SDL_GPUDevice>): Pointer<SDL_GPUComputePipeline> | null {`,
                "    return loadComputePipeline(",
                "        device,",
                `        "${path}",`,
                `        "${entry.name}",`,
                `        ${counts.samplers}, // samplers`,
                `        ${counts.readonlyStorageTextures}, // read-only storage textures`,
                `        ${counts.readonlyStorageBuffers}, // read-only storage buffers`,
                `        ${counts.readwriteStorageTextures}, // read-write storage textures`,
                `        ${counts.readwriteStorageBuffers}, // read-write storage buffers`,
                `        ${counts.uniformBuffers}, // uniform buffers`,
                `        ${entry.threads[0]},`,
                `        ${entry.threads[1]},`,
                `        ${entry.threads[2]},`,
                "    );",
                "}",
                "",
            );
            continue;
        }

        const stage = entry.stage === "vertex" ? "VERTEX" : "FRAGMENT";
        lines.push(
            `/** \`${entry.module}.wgsl\` :: \`${entry.name}\` — ${entry.stage}. */`,
            `export function ${name}(device: Pointer<SDL_GPUDevice>): Pointer<SDL_GPUShader> | null {`,
            "    return loadShader(",
            "        device,",
            `        "${path}",`,
            `        "${entry.name}",`,
            `        SDL_GPUShaderStage.${stage},`,
            `        ${counts.samplers}, // samplers`,
            `        ${counts.storageTextures}, // storage textures`,
            `        ${counts.storageBuffers}, // storage buffers`,
            `        ${counts.uniformBuffers}, // uniform buffers`,
            "    );",
            "}",
            "",
        );
    }

    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// SDL3, and the Goblin program itself.
// ---------------------------------------------------------------------------

/**
 * An SDL family library, fetched as a prebuilt `-VC` package on Windows.
 *
 * Every one of these releases has the same shape — `<name>-<version>/lib/x64`
 * holding the import library, the DLL, and sometimes an `optional/` folder of
 * codec DLLs — so one routine serves all of them and adding SDL3_mixer later is
 * a line in the list below.
 */
interface NativeDependency {
    /** The repository under `libsdl-org`. Not derivable: SDL3 lives in `SDL`, SDL3_image in `SDL_image`. */
    readonly repo: string;
    /** Library name, which is also the extracted folder's prefix and the `.lib` stem. */
    readonly name: string;
    readonly version: string;
    /** The pkg-config package, for the platforms that use one. */
    readonly pkgConfig: string;
}

const DEPENDENCIES: readonly NativeDependency[] = [
    { repo: "SDL", name: "SDL3", version: "3.4.14", pkgConfig: "sdl3" },
    { repo: "SDL_image", name: "SDL3_image", version: "3.4.4", pkgConfig: "sdl3-image" },
    { repo: "SDL_ttf", name: "SDL3_ttf", version: "3.2.2", pkgConfig: "sdl3-ttf" },
];

const DEPENDENCY_ROOT = "build/sdl3";

/** Where a dependency's `x64` libraries live once extracted. Relative to the project root. */
function libraryDirectory(dep: NativeDependency): string {
    return `${DEPENDENCY_ROOT}/${dep.name}-${dep.version}/lib/x64`;
}

/**
 * Download and extract one devel package, if it is not already there.
 *
 * Keyed on the import library existing, so a half-extracted directory is
 * re-fetched rather than trusted.
 */
async function ensureDevelPackage(dep: NativeDependency): Promise<string> {
    const lib = libraryDirectory(dep);

    if (!(await Bun.file(`${lib}/${dep.name}.lib`).exists())) {
        const zipName = `${dep.name}-devel-${dep.version}-VC`;
        const zip = `${DEPENDENCY_ROOT}/${zipName}.zip`;
        const url = `https://github.com/libsdl-org/${dep.repo}/releases/download/release-${dep.version}/${zipName}.zip`;

        console.log(`deps: fetching ${dep.name} ${dep.version}`);
        await Bun.$`mkdir -p ${DEPENDENCY_ROOT}`;
        await Bun.$`curl.exe -L --fail --silent --show-error --max-time 300 -o ${zip} ${url}`;
        await Bun.$`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zip}', '${DEPENDENCY_ROOT}')"`;
        await Bun.$`rm ${zip}`;
    }

    return resolve(import.meta.dir, lib);
}

/**
 * Copy a dependency's runtime DLLs next to the executable.
 *
 * **The `optional/` folder is not optional to us.** It holds the codec DLLs —
 * `libpng16-16.dll` and the TIFF, WebP and AVIF libraries — and SDL3_image
 * links none of them statically. Without them the library loads, `IMG_Load`
 * runs, and every PNG fails at run time with a message about an unsupported
 * format. They are copied wholesale rather than picked from, because the set
 * that matters is the set of formats somebody might reach for.
 */
async function copyRuntimeLibraries(dep: NativeDependency, lib: string): Promise<void> {
    await Bun.write(`bin/${dep.name}.dll`, Bun.file(`${lib}/${dep.name}.dll`));

    const optional = join(lib, "optional");
    let codecs: string[] = [];
    try {
        codecs = (await readdir(optional)).filter((name) => name.endsWith(".dll"));
    } catch {
        // No `optional/` folder. SDL3 itself has none; this is not an error.
        return;
    }

    for (const codec of codecs) {
        await Bun.write(`bin/${codec}`, Bun.file(join(optional, codec)));
    }

    if (codecs.length > 0) {
        console.log(`deps: ${dep.name} codecs -> bin/ (${codecs.join(", ")})`);
    }
}

await buildShaders();

const windows = process.platform === "win32";
const libraryDirectories = windows
    ? await Promise.all(DEPENDENCIES.map((dep) => ensureDevelPackage(dep)))
    : [];

const result = await compile({
    entry: "./src/main.ts",
    tsconfig: "./src/tsconfig.json",

    type: "bin",
    output: "./bin/encke",

    optLevel: "O2",
    debugInfo: true,

    nativeLibs: DEPENDENCIES.map((dep, index) =>
        windows
            ? systemLib(dep.name, { search: [libraryDirectories[index]!] })
            : systemLib(dep.name, { pkgConfig: dep.pkgConfig }),
    ),

    outDir: "./build",
    root: import.meta.dir,
});

if (!result.ok) {
    console.error(formatAll(result.diagnostics, { color: true, cwd: import.meta.dir }));
    process.exit(1);
}

console.log(`built ${result.output}`);

if (windows) {
    for (const [index, dep] of DEPENDENCIES.entries()) {
        await copyRuntimeLibraries(dep, libraryDirectories[index]!);
    }
}
