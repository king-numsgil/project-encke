// A free-flying camera.
//
// Right-handed view space with the camera looking down `-Z`, which is what
// `fmat4.lookAt` and `fmat4.perspective` produce and what every piece of the
// cluster arithmetic assumes. A view-space point in front of the camera has a
// negative `z`, and the positive distance the cluster grid is indexed by is its
// negation — the shaders spell that out at each use rather than carrying a
// sign-flipped copy around.

import { fmat4, fvec3 } from "std/linalg";
import { fcos, fpi, fsin } from "std/math";

export class Camera {
    position: fvec3;

    /** Radians. Zero looks down `-Z`; positive turns towards `+X`. */
    yaw: f32;

    /** Radians, clamped away from the poles so the up vector never degenerates. */
    pitch: f32;

    fovY: f32;
    near: f32;
    far: f32;

    constructor() {
        this.position = fvec3.zero();
        this.yaw = 0.0;
        this.pitch = 0.0;
        // Overwritten from `config.ts` by whoever builds the camera; these are
        // only here so the object is never half-formed.
        this.fovY = 1.0471975512;
        this.near = 0.1;
        this.far = 500.0;
    }

    place(position: fvec3, yaw: f32, pitch: f32): void {
        this.position = position;
        this.yaw = yaw;
        this.pitch = pitch;
    }

    /** Unit vector the camera looks along. */
    forward(): fvec3 {
        const cosPitch = fcos(this.pitch);
        return new fvec3(fsin(this.yaw) * cosPitch, fsin(this.pitch), -fcos(this.yaw) * cosPitch);
    }

    /** Unit vector to the camera's right, level with the horizon. */
    right(): fvec3 {
        return new fvec3(fcos(this.yaw), 0.0, fsin(this.yaw));
    }

    view(): fmat4 {
        return fmat4.lookAt(this.position, this.position.add(this.forward()), new fvec3(0.0, 1.0, 0.0));
    }

    projection(aspect: f32): fmat4 {
        return fmat4.perspective(this.fovY, aspect, this.near, this.far);
    }

    /**
     * Turn. Pitch stops just short of vertical.
     *
     * At exactly +/- 90 degrees the forward vector is parallel to world up and
     * `lookAt`'s cross product collapses, which shows up as the view flipping
     * end over end rather than as anything obviously numerical.
     */
    rotate(deltaYaw: f32, deltaPitch: f32): void {
        const limit = fpi() * 0.5 - 0.01;
        this.yaw += deltaYaw;
        this.pitch += deltaPitch;

        if (this.pitch > limit) {
            this.pitch = limit;
        }
        if (this.pitch < -limit) {
            this.pitch = -limit;
        }
    }

    /** Move along the camera's own axes. `up` is world up, not the camera's. */
    move(forwardAmount: f32, rightAmount: f32, upAmount: f32): void {
        this.position = this.position
            .addScaled(this.forward(), forwardAmount)
            .addScaled(this.right(), rightAmount);
        this.position.y += upAmount;
    }
}
