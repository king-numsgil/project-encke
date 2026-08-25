import { compile, formatAll, systemLib } from "goblin-forge";

await Bun.$`cargo run --quiet --release --manifest-path tools/shadercc/Cargo.toml -- shaders/triangle.wgsl -e vs_main -o shaders/out`;
await Bun.$`cargo run --quiet --release --manifest-path tools/shadercc/Cargo.toml -- shaders/triangle.wgsl -e fs_main -o shaders/out`;
await Bun.$`cargo run --quiet --release --manifest-path tools/shadercc/Cargo.toml -- shaders/checker.wgsl -e generate -o shaders/out`;

const result = await compile({
    entry: "./src/main.ts",
    tsconfig: "./src/tsconfig.json",

    type: "bin",
    output: "./bin/encke",

    optLevel: "O2",
    debugInfo: true,

    nativeLibs: [
        systemLib("SDL3", {
            search: [
                "F:\\Programming\\SDL3\\SDL3-3.4.14\\lib\\x64",
            ],
        }),
    ],

    outDir: "./build",
    root: import.meta.dir,
});

if (!result.ok) {
    console.error(formatAll(result.diagnostics, { color: true, cwd: import.meta.dir }));
    process.exit(1);
}

console.log(`built ${result.output}`);
