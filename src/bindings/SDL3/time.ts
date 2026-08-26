export interface SDL_DateTime {
    year: i32;
    month: i32;
    day: i32;
    hour: i32;
    minute: i32;
    second: i32;
    nanosecond: i32;
    day_of_week: i32;
    utc_offset: i32;
}

export enum SDL_DateFormat {
    YYYYMMDD = 0,
    DDMMYYYY = 1,
    MMDDYYYY = 2,
}

export enum SDL_TimeFormat {
    FORMAT_24H = 0,
    FORMAT_12H = 1,
}

export declare function SDL_GetDateTimeLocalePreferences(
    dateFormat: Pointer<SDL_DateFormat>,
    timeFormat: Pointer<SDL_TimeFormat>,
): boolean;

export declare function SDL_GetCurrentTime(ticks: Pointer<i64>): boolean;

export declare function SDL_TimeToDateTime(ticks: i64, dt: Pointer<SDL_DateTime>, localTime: boolean): boolean;

export declare function SDL_DateTimeToTime(dt: Pointer<SDL_DateTime>, ticks: Pointer<i64>): boolean;

export declare function SDL_GetDaysInMonth(year: i32, month: i32): i32;

export declare function SDL_GetDayOfYear(year: i32, month: i32, day: i32): i32;

export declare function SDL_GetDayOfWeek(year: i32, month: i32, day: i32): i32;
