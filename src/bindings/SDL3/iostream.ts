export enum SDL_IOStatus {
    READY,
    ERROR,
    EOF,
    NOT_READY,
    READONLY,
    WRITEONLY,
}

export enum SDL_IOWhence {
    SET,
    CUR,
    END,
}

export declare class SDL_IOStream {private _opaque: never;}

export declare function SDL_IOFromFile(file: CString, mode: CString): Pointer<SDL_IOStream> | null;

export declare function SDL_IOFromMem(mem: Pointer<unknown>, size: usize): Pointer<SDL_IOStream> | null;

export declare function SDL_IOFromConstMem(mem: Pointer<unknown>, size: usize): Pointer<SDL_IOStream> | null;

export declare function SDL_IOFromDynamicMem(): Pointer<SDL_IOStream> | null;

export declare function SDL_CloseIO(context: Pointer<SDL_IOStream>): boolean;

export declare function SDL_GetIOStatus(context: Pointer<SDL_IOStream>): SDL_IOStatus;

export declare function SDL_GetIOSize(context: Pointer<SDL_IOStream>): isize;

export declare function SDL_SeekIO(context: Pointer<SDL_IOStream>, offset: isize, whence: SDL_IOWhence): isize;

export declare function SDL_TellIO(context: Pointer<SDL_IOStream>): isize;

export declare function SDL_ReadIO(context: Pointer<SDL_IOStream>, ptr: Pointer<unknown>, size: usize): usize;

export declare function SDL_WriteIO(context: Pointer<SDL_IOStream>, ptr: Pointer<unknown>, size: usize): usize;

export declare function SDL_FlushIO(context: Pointer<SDL_IOStream>): boolean;

export declare function SDL_LoadFile_IO(src: Pointer<SDL_IOStream>, datasize: Pointer<usize>, closeio: boolean): Pointer<unknown> | null;

export declare function SDL_LoadFile(file: CString, datasize: Pointer<usize>): Pointer<unknown> | null;

export declare function SDL_SaveFile_IO(src: Pointer<SDL_IOStream>, data: Pointer<unknown>, datasize: usize, closeio: boolean): boolean;

export declare function SDL_SaveFile(file: CString, data: Pointer<unknown>, datasize: usize): boolean;

export declare function SDL_ReadU8(context: Pointer<SDL_IOStream>, value: Pointer<u8>): boolean;

export declare function SDL_ReadS8(context: Pointer<SDL_IOStream>, value: Pointer<i8>): boolean;

export declare function SDL_ReadU16LE(context: Pointer<SDL_IOStream>, value: Pointer<u16>): boolean;

export declare function SDL_ReadS16LE(context: Pointer<SDL_IOStream>, value: Pointer<i16>): boolean;

export declare function SDL_ReadU16BE(context: Pointer<SDL_IOStream>, value: Pointer<u16>): boolean;

export declare function SDL_ReadS16BE(context: Pointer<SDL_IOStream>, value: Pointer<i16>): boolean;

export declare function SDL_ReadU32LE(context: Pointer<SDL_IOStream>, value: Pointer<u32>): boolean;

export declare function SDL_ReadS32LE(context: Pointer<SDL_IOStream>, value: Pointer<i32>): boolean;

export declare function SDL_ReadU32BE(context: Pointer<SDL_IOStream>, value: Pointer<u32>): boolean;

export declare function SDL_ReadS32BE(context: Pointer<SDL_IOStream>, value: Pointer<i32>): boolean;

export declare function SDL_ReadU64LE(context: Pointer<SDL_IOStream>, value: Pointer<u64>): boolean;

export declare function SDL_ReadS64LE(context: Pointer<SDL_IOStream>, value: Pointer<i64>): boolean;

export declare function SDL_ReadU64BE(context: Pointer<SDL_IOStream>, value: Pointer<u64>): boolean;

export declare function SDL_ReadS64BE(context: Pointer<SDL_IOStream>, value: Pointer<i64>): boolean;

export declare function SDL_WriteU8(context: Pointer<SDL_IOStream>, value: u8): boolean;

export declare function SDL_WriteS8(context: Pointer<SDL_IOStream>, value: i8): boolean;

export declare function SDL_WriteU16LE(context: Pointer<SDL_IOStream>, value: u16): boolean;

export declare function SDL_WriteS16LE(context: Pointer<SDL_IOStream>, value: i16): boolean;

export declare function SDL_WriteU16BE(context: Pointer<SDL_IOStream>, value: u16): boolean;

export declare function SDL_WriteS16BE(context: Pointer<SDL_IOStream>, value: i16): boolean;

export declare function SDL_WriteU32LE(context: Pointer<SDL_IOStream>, value: u32): boolean;

export declare function SDL_WriteS32LE(context: Pointer<SDL_IOStream>, value: i32): boolean;

export declare function SDL_WriteU32BE(context: Pointer<SDL_IOStream>, value: u32): boolean;

export declare function SDL_WriteS32BE(context: Pointer<SDL_IOStream>, value: i32): boolean;

export declare function SDL_WriteU64LE(context: Pointer<SDL_IOStream>, value: u64): boolean;

export declare function SDL_WriteS64LE(context: Pointer<SDL_IOStream>, value: i64): boolean;

export declare function SDL_WriteU64BE(context: Pointer<SDL_IOStream>, value: u64): boolean;

export declare function SDL_WriteS64BE(context: Pointer<SDL_IOStream>, value: i64): boolean;
