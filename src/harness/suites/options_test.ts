// The command line.
//
// `options.ts` grows a flag every time the renderer grows a feature, and its
// parser is one long `else if` chain over indices — the shape where an off-by-one
// in the `i += 2` silently eats the next flag. None of that was covered before
// this suite, and none of it fails loudly: a mis-parsed `--present` runs the
// benchmark in the wrong mode and reports a number that looks fine.
//
// **The `options: ...` lines this suite prints are the point, not noise.** Half
// the checks here are negative — a value the parser must refuse — and refusing
// one means printing why. A silent run of this suite would mean the parser had
// stopped explaining itself.

import { SDL_GPUPresentMode } from "../../bindings/SDL3";
import {
    debugViewName,
    parseOptions,
    presentModeName,
    runModeBenches,
    runModeList,
    runModeName,
    runModeTests,
} from "../../app/options.ts";
import type { Tester } from "../testing.ts";

export function testOptions(t: Reference<Tester>): void {
    // -- the defaults, which are also what `--help` describes -----------------

    const empty: string[] = [];
    const defaults = parseOptions(empty);
    t.equalI32("default width", defaults.width, 1600);
    t.equalI32("default height", defaults.height, 900);
    t.equalUsize("default lights", cast<usize>(defaults.lights), 160);
    t.equalUsize("default frames", cast<usize>(defaults.frames), 0);
    t.equalF32("default model scale", defaults.modelScale, 1.0);
    t.ok("the overlay is on by default", defaults.overlay);
    t.ok("no debug view by default", defaults.debug === 0);
    t.ok("not a benchmark by default", !defaults.bench);
    t.ok("not headless by default", !defaults.headless);
    t.ok("no screenshot by default", defaults.screenshot.length === 0);
    t.ok("no model by default", defaults.model.length === 0);
    t.ok("nothing invalid", !defaults.invalid);
    t.ok("mailbox by default", defaults.present === SDL_GPUPresentMode.MAILBOX);
    t.ok("the harness runs tests by default", defaults.harness === runModeTests());

    // -- argv's first entry ---------------------------------------------------
    //
    // `args` arrives as C's `argv`, so entry zero is the program's own path. It
    // is skipped by shape rather than by position, so a caller who already
    // stripped it is not punished — both of these have to parse the same.

    const withProgram: string[] = ["bin/encke", "--width", "800"];
    t.equalI32("argv[0] is skipped", parseOptions(withProgram).width, 800);

    const withoutProgram: string[] = ["--width", "800"];
    t.equalI32("a stripped argv still parses", parseOptions(withoutProgram).width, 800);

    // -- integers -------------------------------------------------------------

    const size: string[] = ["--width", "2560", "--height", "1440"];
    const sized = parseOptions(size);
    t.equalI32("--width", sized.width, 2560);
    t.equalI32("--height", sized.height, 1440);
    t.ok("a valid size is not invalid", !sized.invalid);

    const zeroWidth: string[] = ["--width", "0"];
    t.ok("--width 0 is refused", parseOptions(zeroWidth).invalid);

    const wordWidth: string[] = ["--width", "wide"];
    t.ok("--width wide is refused", parseOptions(wordWidth).invalid);

    // A trailing digit-like string with a non-digit in it, which is the case a
    // naive parser accepts by stopping early.
    const mixedWidth: string[] = ["--width", "12x"];
    t.ok("--width 12x is refused", parseOptions(mixedWidth).invalid);

    const negativeLights: string[] = ["--lights", "-4"];
    t.ok("--lights -4 is refused", parseOptions(negativeLights).invalid);

    const noLights: string[] = ["--lights", "0"];
    const dark = parseOptions(noLights);
    t.ok("--lights 0 is allowed", !dark.invalid);
    t.equalUsize("--lights 0", cast<usize>(dark.lights), 0);

    // -- present modes --------------------------------------------------------

    const immediate: string[] = ["--present", "immediate"];
    t.ok(
        "--present immediate",
        parseOptions(immediate).present === SDL_GPUPresentMode.IMMEDIATE,
    );

    const vsync: string[] = ["--present", "vsync"];
    t.ok("--present vsync", parseOptions(vsync).present === SDL_GPUPresentMode.VSYNC);

    const nonsense: string[] = ["--present", "fast"];
    t.ok("--present fast is refused", parseOptions(nonsense).invalid);

    t.equalText("mode name: vsync", presentModeName(SDL_GPUPresentMode.VSYNC), "vsync");
    t.equalText("mode name: mailbox", presentModeName(SDL_GPUPresentMode.MAILBOX), "mailbox");
    t.equalText("mode name: immediate", presentModeName(SDL_GPUPresentMode.IMMEDIATE), "immediate");

    // -- debug views ----------------------------------------------------------
    //
    // These numbers are mirrored by `DEBUG_*` in `shaders/forward.wgsl`. A
    // renumbering here without one there draws the wrong view, which looks like
    // a shader bug.

    const clusters: string[] = ["--debug", "clusters"];
    t.ok("--debug clusters is view 1", parseOptions(clusters).debug === 1);

    const ao: string[] = ["--debug", "ao"];
    t.ok("--debug ao is view 2", parseOptions(ao).debug === 2);

    const cascades: string[] = ["--debug", "cascades"];
    t.ok("--debug cascades is view 3", parseOptions(cascades).debug === 3);

    const offView: string[] = ["--debug", "off"];
    t.ok("--debug off is view 0", parseOptions(offView).debug === 0);

    const badView: string[] = ["--debug", "wireframe"];
    t.ok("--debug wireframe is refused", parseOptions(badView).invalid);

    t.equalText("view name round trip: clusters", debugViewName(1), "clusters");
    t.equalText("view name round trip: ao", debugViewName(2), "ao");
    t.equalText("view name round trip: cascades", debugViewName(3), "cascades");
    t.equalText("view name round trip: off", debugViewName(0), "off");

    // -- the benchmark's side effect -------------------------------------------
    //
    // `--bench` turns the overlay off, because a benchmark that measures
    // something other than the renderer is a benchmark with an argument in it.
    // An explicit `--overlay on` afterwards still wins, and the ordering is the
    // whole behaviour.

    const bench: string[] = ["--bench", "300"];
    const benched = parseOptions(bench);
    t.ok("--bench sets bench", benched.bench);
    t.equalUsize("--bench sets frames", cast<usize>(benched.frames), 300);
    t.ok("--bench turns the overlay off", !benched.overlay);

    const benchOverlay: string[] = ["--bench", "300", "--overlay", "on"];
    t.ok("--overlay on after --bench wins", parseOptions(benchOverlay).overlay);

    const overlayBench: string[] = ["--overlay", "on", "--bench", "300"];
    t.ok("--overlay on before --bench loses", !parseOptions(overlayBench).overlay);

    const badBench: string[] = ["--bench", "0"];
    t.ok("--bench 0 is refused", parseOptions(badBench).invalid);

    const badOverlay: string[] = ["--overlay", "yes"];
    t.ok("--overlay yes is refused", parseOptions(badOverlay).invalid);

    // -- fractional numbers ----------------------------------------------------
    //
    // `parseNumber` accumulates in `f64` and narrows once, so a small scale is
    // the nearest `f32` to a thousandth rather than the nearest `f32` to a sum
    // of three `f32` divisions.

    const small: string[] = ["--model-scale", "0.001"];
    t.nearly("--model-scale 0.001", parseOptions(small).modelScale, 0.001, 1e-9);

    const big: string[] = ["--model-scale", "2.5"];
    t.equalF32("--model-scale 2.5", parseOptions(big).modelScale, 2.5);

    const whole: string[] = ["--model-scale", "10"];
    t.equalF32("--model-scale 10", parseOptions(whole).modelScale, 10.0);

    const twoPoints: string[] = ["--model-scale", "1.2.3"];
    t.ok("--model-scale 1.2.3 is refused", parseOptions(twoPoints).invalid);

    const zeroScale: string[] = ["--model-scale", "0"];
    t.ok("--model-scale 0 is refused", parseOptions(zeroScale).invalid);

    // -- strings ---------------------------------------------------------------

    const paths: string[] = ["--screenshot", "out.png", "--model", "assets/models/x.glb"];
    const pathed = parseOptions(paths);
    t.equalText("--screenshot", pathed.screenshot, "out.png");
    t.equalText("--model", pathed.model, "assets/models/x.glb");

    // -- the headless harness ---------------------------------------------------

    const headless: string[] = ["--headless"];
    const bare = parseOptions(headless);
    t.ok("--headless", bare.headless);
    t.ok("--headless runs tests", bare.harness === runModeTests());

    const benches: string[] = ["--run", "benches"];
    const benching = parseOptions(benches);
    t.ok("--run implies --headless", benching.headless);
    t.ok("--run benches", benching.harness === runModeBenches());

    const listing: string[] = ["--run", "list"];
    t.ok("--run list", parseOptions(listing).harness === runModeList());

    const badRun: string[] = ["--run", "everything"];
    t.ok("--run everything is refused", parseOptions(badRun).invalid);

    const filtered: string[] = ["--filter", "ecs/"];
    const filter = parseOptions(filtered);
    t.ok("--filter implies --headless", filter.headless);
    t.equalText("--filter", filter.filter, "ecs/");

    t.equalText("run mode name: tests", runModeName(runModeTests()), "tests");
    t.equalText("run mode name: benches", runModeName(runModeBenches()), "benches");
    t.equalText("run mode name: list", runModeName(runModeList()), "list");

    // -- help and the unrecognised ----------------------------------------------

    const help: string[] = ["--help"];
    t.ok("--help", parseOptions(help).help);

    const shortHelp: string[] = ["-h"];
    t.ok("-h", parseOptions(shortHelp).help);

    const unknown: string[] = ["--raytrace"];
    t.ok("an unrecognised flag is refused", parseOptions(unknown).invalid);

    // A flag that wants a value and does not get one falls through to the
    // unrecognised branch rather than reading past the end of the array.
    const dangling: string[] = ["--width"];
    t.ok("a value-less --width is refused", parseOptions(dangling).invalid);

    // -- several flags at once ----------------------------------------------------

    const everything: string[] = [
        "bin/encke",
        "--width", "1280",
        "--height", "720",
        "--present", "immediate",
        "--lights", "40",
        "--debug", "clusters",
        "--frames", "90",
        "--screenshot", "shot.png",
    ];
    const all = parseOptions(everything);
    t.ok("a full command line is valid", !all.invalid);
    t.equalI32("full: width", all.width, 1280);
    t.equalI32("full: height", all.height, 720);
    t.ok("full: present", all.present === SDL_GPUPresentMode.IMMEDIATE);
    t.equalUsize("full: lights", cast<usize>(all.lights), 40);
    t.ok("full: debug", all.debug === 1);
    t.equalUsize("full: frames", cast<usize>(all.frames), 90);
    t.equalText("full: screenshot", all.screenshot, "shot.png");
}
