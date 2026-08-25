// Translated from SDL_sensor.h

import type { SDL_PropertiesID } from "./properties.ts";

/** The opaque structure used to identify an opened SDL sensor. */
export declare class SDL_Sensor {
    private _opaque: never;
}

/** A unique ID for a sensor for the time it is connected. Never zero. */
export type SDL_SensorID = u32;

/** The different sensors defined by SDL. */
export enum SDL_SensorType {
    /** Returned for an invalid index */
    INVALID = -1,
    /** Unknown sensor type */
    UNKNOWN,
    /** Accelerometer */
    ACCEL,
    /** Gyroscope */
    GYRO,
    /** Accelerometer for the left Joy-Con controller and Wii nunchuk */
    ACCEL_L,
    /** Gyroscope for the left Joy-Con controller */
    GYRO_L,
    /** Accelerometer for the right Joy-Con controller */
    ACCEL_R,
    /** Gyroscope for the right Joy-Con controller */
    GYRO_R,
    COUNT,
}

export declare namespace SDL_SensorType {
    type Underlying = i32;
}

/**
 * Gravity in m/s², the unit accelerometer values are reported in.
 *
 * 9.80665 — `SDL_STANDARD_GRAVITY` in the header. It is a function because the
 * compiler has no module-level `const` yet.
 */
export function SDL_STANDARD_GRAVITY(): f32 {
    return 9.80665;
}

/** The array is SDL's allocation: release it with `SDL_free`. */
export declare function SDL_GetSensors(count: Pointer<i32> | null): Pointer<SDL_SensorID> | null;

export declare function SDL_GetSensorNameForID(instance_id: SDL_SensorID): CString | null;

export declare function SDL_GetSensorTypeForID(instance_id: SDL_SensorID): SDL_SensorType;

export declare function SDL_GetSensorNonPortableTypeForID(instance_id: SDL_SensorID): i32;

export declare function SDL_OpenSensor(instance_id: SDL_SensorID): Pointer<SDL_Sensor> | null;

export declare function SDL_GetSensorFromID(instance_id: SDL_SensorID): Pointer<SDL_Sensor> | null;

export declare function SDL_GetSensorProperties(sensor: Pointer<SDL_Sensor>): SDL_PropertiesID;

export declare function SDL_GetSensorName(sensor: Pointer<SDL_Sensor>): CString | null;

export declare function SDL_GetSensorType(sensor: Pointer<SDL_Sensor>): SDL_SensorType;

export declare function SDL_GetSensorNonPortableType(sensor: Pointer<SDL_Sensor>): i32;

export declare function SDL_GetSensorID(sensor: Pointer<SDL_Sensor>): SDL_SensorID;

/**
 * The current sensor reading.
 *
 * `data` is a buffer of `num_values` floats; how many are meaningful depends on
 * the sensor. An accelerometer or gyroscope reports three.
 */
export declare function SDL_GetSensorData(sensor: Pointer<SDL_Sensor>, data: Pointer<f32>, num_values: i32): boolean;

export declare function SDL_CloseSensor(sensor: Pointer<SDL_Sensor>): void;

/** Only needed when events are disabled; `SDL_PumpEvents` does this otherwise. */
export declare function SDL_UpdateSensors(): void;
