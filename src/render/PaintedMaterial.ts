import * as THREE from 'three';
import { brushTexture, toonRamp } from './Textures';

/**
 * Material "pintado a mano": MeshToonMaterial con rampa de bandas suaves
 * + pinceladas en espacio de mundo que modulan el color.
 * Funciona con instancing, vertex colors, sombras y niebla.
 */

let brush: THREE.Texture | null = null;
let ramp: THREE.Texture | null = null;

export interface PaintedOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  brushScale?: number; // frecuencia de pincelada (1/m)
  brushAmount?: number; // 0..0.5
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  emissive?: THREE.ColorRepresentation;
  nightMap?: THREE.Texture;
  nightOnly?: boolean;
  polygonOffset?: number;
  rim?: number; // luz de borde
}

export const sharedUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
};

export function paintedMaterial(o: PaintedOptions = {}): THREE.MeshToonMaterial {
  brush ??= brushTexture();
  ramp ??= toonRamp();
  const m = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    map: o.map ?? null,
    vertexColors: !!o.vertexColors,
    gradientMap: ramp,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    alphaTest: o.alphaTest ?? 0,
    emissive: o.emissive ?? (o.nightMap ? 0xffcb80 : 0x000000),
    emissiveMap: o.nightMap ?? null,
  });
  if (o.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -o.polygonOffset;
    m.polygonOffsetUnits = -o.polygonOffset;
  }
  const scale = o.brushScale ?? 0.25;
  const amount = o.brushAmount ?? 0.22;
  const rim = o.rim ?? 0.12;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sharedUniforms.uNight;
    shader.uniforms.uBrush = { value: brush };
    shader.uniforms.uBrushScale = { value: scale };
    shader.uniforms.uBrushAmt = { value: amount };
    shader.uniforms.uRim = { value: rim };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaintWorld;\nvarying vec3 vPaintNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cpw = vec4(transformed, 1.0);
        vec3 cpn = objectNormal;
        #ifdef USE_INSTANCING
          cpw = instanceMatrix * cpw;
          cpn = mat3(instanceMatrix) * cpn;
        #endif
        vPaintWorld = (modelMatrix * cpw).xyz;
        vPaintNormal = normalize(mat3(modelMatrix) * cpn);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight; uniform sampler2D uBrush; uniform float uBrushScale; uniform float uBrushAmt; uniform float uRim;
        varying vec3 vPaintWorld; varying vec3 vPaintNormal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 an = abs(vPaintNormal);
          vec2 uvA = vPaintWorld.xz * uBrushScale;
          vec2 uvB = (an.x > an.z ? vPaintWorld.zy : vPaintWorld.xy) * uBrushScale;
          float wTop = smoothstep(0.45, 0.8, an.y);
          float b = mix(texture2D(uBrush, uvB).r, texture2D(uBrush, uvA).r, wTop);
          float b2 = texture2D(uBrush, uvA * 0.137 + 0.31).r;
          float k = (b - 0.5) * 2.0 * uBrushAmt + (b2 - 0.5) * uBrushAmt;
          diffuseColor.rgb *= 1.0 + k;
          // leve variación cálida/fría según el trazo
          diffuseColor.rgb += vec3(0.03, 0.015, -0.02) * k * 3.0;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V = normalize(cameraPosition - vPaintWorld);
          float rimF = pow(1.0 - max(dot(normalize(vPaintNormal), V), 0.0), 3.0) * uRim;
          outgoingLight += vec3(1.0, 0.95, 0.85) * (1.0 - uNight * .8) * rimF * max(vPaintNormal.y + 0.3, 0.0);
        }
        #include <opaque_fragment>`,
      );
  };
  const compile = m.onBeforeCompile;
  if (o.nightMap || o.nightOnly) m.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= uNight;');
  };
  // las variantes comparten programa según parámetros
  m.customProgramCacheKey = () => `painted-${scale}-${amount}-${rim}-${!!o.nightMap || !!o.nightOnly}`;
  return m;
}
