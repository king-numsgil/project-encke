export declare function SDL_malloc(size: usize): Pointer<unknown> | null;

export declare function SDL_calloc(nmemb: usize, size: usize): Pointer<unknown> | null;

export declare function SDL_realloc(mem: Pointer<unknown> | null, size: usize): Pointer<unknown> | null;

export declare function SDL_free(ptr: Pointer<unknown> | null): void;

export declare function SDL_SetMemoryFunctions(
    malloc_func: ((size: usize) => Pointer<unknown> | null) | null,
    calloc_func: ((nmemb: usize, size: usize) => Pointer<unknown> | null) | null,
    realloc_func: ((mem: Pointer<unknown> | null, size: usize) => Pointer<unknown> | null) | null,
    free_func: ((mem: Pointer<unknown> | null) => void) | null,
): boolean;

export declare function SDL_aligned_alloc(alignment: usize, size: usize): Pointer<unknown> | null;

export declare function SDL_aligned_free(ptr: Pointer<unknown>): void;

export declare function SDL_GetNumAllocations(): i32;

export declare class SDL_Environment { private _opaque: never; }

export declare function SDL_GetEnvironment(): Pointer<SDL_Environment> | null;

export declare function SDL_CreateEnvironment(populated: boolean): Pointer<SDL_Environment> | null;

export declare function SDL_GetEnvironmentVariable(env: Pointer<SDL_Environment>, name: CString): CString | null;

export declare function SDL_GetEnvironmentVariables(env: Pointer<SDL_Environment>): Pointer<CString> | null;

export declare function SDL_SetEnvironmentVariable(env: Pointer<SDL_Environment>, name: CString, value: CString, overwrite: boolean): boolean;

export declare function SDL_UnsetEnvironmentVariable(env: Pointer<SDL_Environment>, name: CString): boolean;

export declare function SDL_DestroyEnvironment(env: Pointer<SDL_Environment>): void;

export declare function SDL_getenv(name: CString): CString | null;

// ---------------------------------------------------------------------------
// Math. SDL's own, so that a program gets the same answers on every platform
// regardless of what the system libm happens to do.
//
// `lround` is not here on purpose: it returns C `long`, which is 32 bits on
// Windows and 64 on everything else, so there is no one Goblin width for it.
// ---------------------------------------------------------------------------

// SDL_FLT_EPSILON (1.1920928955078125e-07), SDL_PI_D and SDL_PI_F are `#define`s
// in the header and are not exported here: the compiler has no module-level
// `const` yet, and an enum holds integers only (GF0166). Write the literal.

export declare function SDL_abs(x: i32): i32;

export declare function SDL_acos(x: f64): f64;
export declare function SDL_acosf(x: f32): f32;

export declare function SDL_asin(x: f64): f64;
export declare function SDL_asinf(x: f32): f32;

export declare function SDL_atan(x: f64): f64;
export declare function SDL_atanf(x: f32): f32;

export declare function SDL_atan2(y: f64, x: f64): f64;
export declare function SDL_atan2f(y: f32, x: f32): f32;

export declare function SDL_ceil(x: f64): f64;
export declare function SDL_ceilf(x: f32): f32;

export declare function SDL_copysign(x: f64, y: f64): f64;
export declare function SDL_copysignf(x: f32, y: f32): f32;

export declare function SDL_cos(x: f64): f64;
export declare function SDL_cosf(x: f32): f32;

export declare function SDL_exp(x: f64): f64;
export declare function SDL_expf(x: f32): f32;

export declare function SDL_fabs(x: f64): f64;
export declare function SDL_fabsf(x: f32): f32;

export declare function SDL_floor(x: f64): f64;
export declare function SDL_floorf(x: f32): f32;

export declare function SDL_trunc(x: f64): f64;
export declare function SDL_truncf(x: f32): f32;

export declare function SDL_fmod(x: f64, y: f64): f64;
export declare function SDL_fmodf(x: f32, y: f32): f32;

export declare function SDL_isinf(x: f64): i32;
export declare function SDL_isinff(x: f32): i32;

export declare function SDL_isnan(x: f64): i32;
export declare function SDL_isnanf(x: f32): i32;

export declare function SDL_log(x: f64): f64;
export declare function SDL_logf(x: f32): f32;

export declare function SDL_log10(x: f64): f64;
export declare function SDL_log10f(x: f32): f32;

export declare function SDL_modf(x: f64, y: Pointer<f64>): f64;
export declare function SDL_modff(x: f32, y: Pointer<f32>): f32;

export declare function SDL_pow(x: f64, y: f64): f64;
export declare function SDL_powf(x: f32, y: f32): f32;

export declare function SDL_round(x: f64): f64;
export declare function SDL_roundf(x: f32): f32;

export declare function SDL_scalbn(x: f64, n: i32): f64;
export declare function SDL_scalbnf(x: f32, n: i32): f32;

export declare function SDL_sin(x: f64): f64;
export declare function SDL_sinf(x: f32): f32;

export declare function SDL_sqrt(x: f64): f64;
export declare function SDL_sqrtf(x: f32): f32;

export declare function SDL_tan(x: f64): f64;
export declare function SDL_tanf(x: f32): f32;
