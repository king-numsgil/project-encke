import { Diagnostic } from "@goblin-forge/checker";
import { OptLevel } from "@goblin-forge/runtime/build";
type OutputKind = "bin" | "static-lib" | "shared-lib";
/**
* A stage of a build, for progress reporting.
*
* Named for what is happening rather than for the function that does it, since
* the audience is somebody watching a build rather than somebody reading this
* file. `runtime` is the one that earns its place on its own: a cold cache
* compiles mimalloc from C source, and a minute of silence there is
* indistinguishable from a hang.
*/
type BuildPhase = "check" | "lower" | "codegen" | "header" | "runtime" | "link";
/**
* What a build reports as it goes.
*
* **Begin and end, not just end**, which is the whole point: a phase that takes
* a minute has to announce itself *before* it takes the minute. Reporting only
* completions would put the message after the wait it was meant to explain.
*/
type BuildEvent = {
	readonly kind: "begin"
	readonly phase: BuildPhase
	readonly detail?: string
} | {
	readonly kind: "end"
	readonly phase: BuildPhase
	/** How long it took, in milliseconds. */
	readonly ms: number
	readonly detail?: string
};
interface CompileOptions {
	/** The entry module. Resolved against {@link CompileOptions.root}. */
	readonly entry: string;
	/** The project's tsconfig. Resolved against {@link CompileOptions.root}. */
	readonly tsconfig: string;
	/**
	* What every other relative path is resolved against.
	*
	* Defaults to the directory of the build script that called `compile`, not
	* the working directory.
	*/
	readonly root?: string;
	readonly type?: OutputKind;
	/** Output path. The platform's extension for the target type is added. */
	readonly output: string;
	readonly nativeLibs?: readonly string[];
	readonly manifests?: readonly string[];
	/**
	* How the Goblin runtime is linked. Defaults to `"static"`.
	*
	* `"static"` is the self-contained answer and the right one for almost
	* everything: the runtime is inside the artefact and there is one file to
	* ship.
	*
	* `"shared"` exists for the one case static linking cannot serve — **two
	* Goblin artefacts in the same process**, a `shared-lib` loaded by a `bin`.
	* Each would otherwise carry its own runtime, and therefore its own heap,
	* its own live-allocation counter and its own copy of `gf_string_free`; a
	* `string` allocated on one side and released on the other is then a
	* cross-heap free. Linked shared, both artefacts import one runtime and
	* there is one of each.
	*
	* The cost is that the runtime is no longer inside the binary. It is copied
	* beside the output and has to stay there — `runtimeImage` in the result
	* says where it landed. This is `/MD` against `/MT`, and the trade is the
	* same one.
	*/
	readonly runtime?: "static" | "shared";
	/** Target triple. Defaults to the host. */
	readonly target?: string;
	readonly optLevel?: OptLevel;
	/** Runtime liveness checks. */
	readonly checked?: boolean;
	readonly debugInfo?: boolean;
	/** Where objects and other intermediates go. */
	readonly outDir?: string;
	readonly emit?: {
		readonly ir?: boolean
		readonly header?: boolean
		readonly declarations?: boolean
	};
	readonly incremental?: boolean;
	/**
	* Panic inside the backend on an internal error rather than returning a
	* diagnostic. REWRITE-PLAN §8: a compiler crash must not be able to read as
	* a clean rejection. The test harness turns this on.
	*/
	readonly strictInternalErrors?: boolean;
	/**
	* Called as each phase begins and ends, for a caller that wants to say what
	* is happening.
	*
	* The one field here that is not plain data, and deliberately the only one.
	* `compile` writes nothing to stdout or stderr — a build is a *result*, and
	* a library that prints is a library you cannot call twice or call quietly.
	* Rendering is the caller's, which is why the CLI owns the wording and the
	* examples stay silent by saying nothing.
	*/
	readonly onProgress?: (event: BuildEvent) => void;
}
interface CompileResult {
	readonly ok: boolean;
	readonly diagnostics: readonly Diagnostic[];
	/** Absolute path of the artifact, when one was produced. */
	readonly output?: string;
	/** Absolute paths of every object file written. */
	readonly objects: readonly string[];
	/** The exact linker command, so a link failure can be reproduced by hand. */
	readonly linkCommand?: string;
	/** Where the MIR was written, when `emit.ir` asked for it. */
	readonly irPath?: string;
	/** Where the C header was written, for a library target. */
	readonly headerPath?: string;
	/**
	* The import library beside a Windows `shared-lib`.
	*
	* Windows has no equivalent of linking straight against a `.so`: a consumer
	* links this stub instead. Absent on every other platform, and absent for
	* every other target kind.
	*/
	readonly importLibrary?: string;
	/**
	* The Goblin runtime archive a consumer of a `static-lib` must also link.
	*
	* A Goblin archive carries only its own objects, so that two of them in one
	* program do not each bring a copy of `gf_string_free`. That makes this the
	* consumer's job, and leaving it to be discovered from a linker error would
	* be unkind.
	*/
	readonly runtimeLibrary?: string;
	/**
	* The shared runtime copied beside the output, for `runtime: "shared"`.
	*
	* It has to stay there: the artefact finds it by looking next to itself.
	* Reported rather than merely done, because "which files do I ship?" now
	* has two answers and only one of them is the output path.
	*/
	readonly runtimeImage?: string;
	/**
	* The shared runtime's import stub, beside a `shared-lib` that links one.
	*
	* What a *consumer* links, alongside this library's own stub. Windows only
	* and `shared-lib` only: an ELF or Mach-O consumer links the shared object
	* itself, which is already reported as {@link runtimeImage}, and nobody
	* links against a `bin` at all.
	*/
	readonly runtimeImportLibrary?: string;
}
/**
* Compile a Goblin program.
*
* Holds nothing between calls. {@link Compiler} is the re-entrant version and
* is what `watch` will use; this is the one-shot convenience over it.
*/
declare function compile(options: CompileOptions): Promise<CompileResult>;
/**
* A compiler with a retained `ts.Program`.
*
* Build twice and the second build reuses everything tsc did not have to redo.
*/
declare class Compiler {
	private;
	constructor(options: CompileOptions);
	build(): Promise<CompileResult>;
}
import ts3 from "typescript";
import { Module as MirModule } from "@goblin-forge/backend";
import { Diagnostic as Diagnostic2 } from "@goblin-forge/checker";
interface LowerResult {
	readonly module: MirModule | undefined;
	readonly diagnostics: readonly Diagnostic2[];
}
declare function lower(program: ts3.Program, checker: ts3.TypeChecker, moduleName: string, options?: {
	readonly requireMain?: boolean
	readonly root?: string
	/** The entry file. Its exports are the build's public ABI. */
	readonly entry?: string
}): LowerResult;
interface SystemLibOptions {
	/**
	* The pkg-config package name, when it is not the library's own.
	*
	* SDL3's is `sdl3` and the default lowercasing finds it. OpenSSL's library
	* is `ssl` and its package is `libssl`, which no rule would have guessed.
	*/
	readonly pkgConfig?: string;
	/** Directories to look in before anywhere else. */
	readonly search?: readonly string[];
	/**
	* Which spelling wins where a machine has both. Defaults to `"shared"`.
	*
	* Shared, because that is what a package manager installs and what a distro
	* expects to be linked — a static build of something like SDL is usually
	* not installed at all, and where it is, it drags in a dependency list that
	* has to be linked by hand. `"static"` for the case LINKING.md prefers,
	* where the artefact should carry the library rather than find it at load.
	*/
	readonly prefer?: "shared" | "static";
}
/**
* The path to a system library, for `nativeLibs`.
*
* ```ts
* {
*     entry: "./src/main.ts",
*     output: "./bin/game",
*     nativeLibs: [systemLib("SDL3")],
* };
* ```
*
* The name is the library's, spelled as the linker would spell it without any
* platform decoration: `SDL3`, not `libSDL3.so` and not `SDL3.lib`. Throws when
* nothing matches, with the names and the directories it tried — a build script
* that cannot find its library has no useful way to carry on, and the failure
* is worth having at the top of the build rather than as a link error at the
* bottom of it.
*/
declare function systemLib(name: string, options?: SystemLibOptions): string;
import { allCodes, Code, CodeEntry, CODES, Diagnostic as Diagnostic3, explain, format, formatAll, FormatOptions, hasErrors, Location, Note, Severity } from "@goblin-forge/checker";
import { globalDeclarations, RuntimeFiles, tsconfigBase, useRuntimeFiles } from "@goblin-forge/runtime/paths";
export { BuildEvent, BuildPhase, CODES, Code, CodeEntry, CompileOptions, CompileResult, Compiler, Diagnostic3 as Diagnostic, FormatOptions, Location, LowerResult, Note, OptLevel, OutputKind, RuntimeFiles, Severity, SystemLibOptions, allCodes, compile, explain, format, formatAll, globalDeclarations, hasErrors, lower, systemLib, tsconfigBase, useRuntimeFiles };
