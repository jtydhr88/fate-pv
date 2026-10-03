// Rendering style for lit 3D objects: 'pbr' (physically based: lacquer, ivory, felt) or 'toon'
// (cel shading in flat tone bands, for the "3D rendered as 2D" look, used with the Outline pass in
// scenes/_kit.ts). Chosen per page with ?style=toon|pbr, so plates can be compared side by side.
import * as THREE from 'three';

export type Style = 'pbr' | 'toon';
export const STYLE: Style = typeof location !== 'undefined' && new URLSearchParams(location.search).get('style') === 'pbr' ? 'pbr' : 'toon';

let ramp: THREE.DataTexture | null = null;
/** The cel ramp: three flat bands (core shadow, half tone, light). */
export function toonRamp() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([46, 128, 255]), 3, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

/**
 * A material for the current style from physically based parameters. In toon style only colour,
 * map and emission carry over (scenes only animate those), the rest is dropped. Typed as the physical
 * material so callers can keep one type; MeshToonMaterial has every member they touch.
 */
export function styled(p: THREE.MeshPhysicalMaterialParameters, style: Style = STYLE): THREE.MeshPhysicalMaterial {
  if (style === 'pbr') return new THREE.MeshPhysicalMaterial(p);
  const m = new THREE.MeshToonMaterial({ color: p.color, map: p.map ?? null, gradientMap: toonRamp() });
  if (p.emissive !== undefined) { m.emissive.set(p.emissive as THREE.ColorRepresentation); m.emissiveIntensity = p.emissiveIntensity ?? 1; }
  return m as unknown as THREE.MeshPhysicalMaterial;
}
