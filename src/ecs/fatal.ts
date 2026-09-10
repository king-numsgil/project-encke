// Stopping, when carrying on would be worse.
//
// This language has no `throw`, and this ECS has no `Result` type, so there are
// two ways to answer a caller that registered a component too large to store:
// abort, or return something inert and let the trouble show up later somewhere
// else.
//
// It aborts. A component's size comes from a type written in the source, fixed
// when the program was compiled, so a component over the limit is wrong in every
// run and wrong before the first one starts. No shipping build could recover
// from it. Returning `noneId()` from `world.component` would only mean that
// every later `set` and `get` against that id quietly did nothing, far from the
// mistake.
//
// Exactly one thing in `ecs/` calls this. Every ordinary refusal — a dead
// handle, an id an entity does not hold, a relation that was never registered —
// is a `false` or a `null` and stays one. Adding a second caller needs the same
// argument: something the source decided, not something the input did.

/**
 * C's `abort`. Raises `SIGABRT`, so a debugger stops here with the stack intact
 * and the shell reports a crash rather than a clean exit.
 *
 * Deliberately not `exit(1)`: an exit runs the leak check on the way out and
 * would print a live-allocation count for a world that never finished being
 * built, which reads as a leak on top of the real error.
 */
declare function abort(): void;

/**
 * Say why, then stop.
 *
 * **Declared `void`, never returns.** `never` has no machine representation in
 * this language yet (`GF0001`), so the signature cannot say what the function
 * does and tsc keeps believing the code after a call is reachable. That only
 * matters where a call has to narrow a value, which the one caller does not do.
 * A future caller that needs the narrowing will have to write a dead branch
 * after the call and explain why it is there.
 */
export function fatal(message: string): void {
    console.error(`ecs: ${message}`);
    abort();
}
