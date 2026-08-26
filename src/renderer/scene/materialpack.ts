// Material to uniform block.
//
// Its own file rather than a method on `Material`, because `Material` is scene
// data and this is a GPU layout — the two change for different reasons, and the
// packing has to be read against `struct Material` in `forward.wgsl` rather than
// against anything in the scene.

import { fvec4 } from "std/linalg";
import type { MaterialUniform } from "../frame/uniforms.ts";
import type { Material } from "./material.ts";

export function fillMaterial(uniform: Pointer<MaterialUniform>, material: Reference<Material>): void {
    uniform.albedo = new fvec4(material.albedo.x, material.albedo.y, material.albedo.z, 1.0);
    uniform.params = new fvec4(material.metallic, material.roughness, material.aoStrength, 0.0);
    uniform.emissive = new fvec4(material.emissive.x, material.emissive.y, material.emissive.z, 0.0);
}
