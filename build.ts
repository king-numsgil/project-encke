import { resolve } from "node:path";
import { compile, formatAll, systemLib } from "goblin-forge";

await Bun.$`cargo run --quiet --release --manifest-path tools/shadercc/Cargo.toml -- shaders/triangle.wgsl -e vs_main -o shaders/out`;
await Bun.$`cargo run --quiet --release --manifest-path tools/shadercc/Cargo.toml -- shaders/triangle.wgsl -e fs_main -o shaders/out`;
await Bun.$`cargo run --quiet --release --manifest-path tools/shadercc/Cargo.toml -- shaders/checker.wgsl -e generate -o shaders/out`;

const SDL3_VERSION = "3.4.14";

async function ensureSdl3Devel(): Promise<string> {
    const zipName = `SDL3-devel-${SDL3_VERSION}-VC`;
    const root = "build/sdl3";
    const lib = `${root}/SDL3-${SDL3_VERSION}/lib/x64`;

    if (!(await Bun.file(`${lib}/SDL3.lib`).exists())) {
        const zip = `${root}/${zipName}.zip`;
        const url = `https://github.com/libsdl-org/SDL/releases/download/release-${SDL3_VERSION}/${zipName}.zip`;

        await Bun.$`mkdir -p ${root}`;
        await Bun.$`curl.exe -L --fail --silent --show-error --max-time 300 -o ${zip} ${url}`;
        await Bun.$`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zip}', '${root}')"`;
        await Bun.$`rm ${zip}`;
    }

    return resolve(import.meta.dir, lib);
}

const sdl3Lib = process.platform === "win32" ? await ensureSdl3Devel() : null;

const result = await compile({
    entry: "./src/main.ts",
    tsconfig: "./src/tsconfig.json",

    type: "bin",
    output: "./bin/encke",

    optLevel: "O2",
    debugInfo: true,

    nativeLibs: sdl3Lib === null ? [systemLib("SDL3")] : [systemLib("SDL3", { search: [sdl3Lib] })],

    outDir: "./build",
    root: import.meta.dir,
});

if (!result.ok) {
    console.error(formatAll(result.diagnostics, { color: true, cwd: import.meta.dir }));
    process.exit(1);
}

console.log(`built ${result.output}`);

if (sdl3Lib !== null) {
    await Bun.write("bin/SDL3.dll", Bun.file(`${sdl3Lib}/SDL3.dll`));
}
