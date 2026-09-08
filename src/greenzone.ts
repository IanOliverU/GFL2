// Green Zone courtyard slice: finished playable service-courtyard district.
// Layout data lives in gz-layout.ts (validated); this module builds meshes,
// registers the matching colliders, and owns the slice's material registry
// (upgraded with procedural canvas textures in the materials pass).
//
// Technique debt (MIT): batching by material into merged static meshes,
// seeded dressing RNG, procedural canvas textures, gradient sky dome with
// sun glow, and canvas signage are adapted from "A Letter to Summer" by
// Eren Ciracioglu (MIT, rev c3f762f, 2026-09-08), reimplemented for
// Babylon.js. See docs/green-zone.md.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GZ_SOLIDS } from "./gz-layout";
import type { AABB } from "./world";

// Deterministic dressing RNG (mulberry32-style; stable across restarts).
function gzRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let n = Math.imul(s ^ (s >>> 15), 1 | s);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function gzMat(scene: Scene, name: string, color: Color3, emissive?: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  if (emissive) m.emissiveColor = emissive;
  m.specularColor = new Color3(0.1, 0.1, 0.12);
  return m;
}

/** Static-geometry batcher: one merged mesh per material (few draw calls). */
class GzBatch {
  private groups = new Map<string, { mat: StandardMaterial; meshes: Mesh[] }>();
  constructor(private scene: Scene) {}
  private push(mat: StandardMaterial, mesh: Mesh): void {
    let g = this.groups.get(mat.name);
    if (!g) { g = { mat, meshes: [] }; this.groups.set(mat.name, g); }
    g.meshes.push(mesh);
  }
  box(mat: StandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): Mesh {
    const m = MeshBuilder.CreateBox(`gz-${mat.name}`, { width: w, height: h, depth: d }, this.scene);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.material = mat;
    this.push(mat, m);
    return m;
  }
  cyl(mat: StandardMaterial, h: number, dTop: number, dBot: number, x: number, y: number, z: number, tess = 10): Mesh {
    const m = MeshBuilder.CreateCylinder(`gz-${mat.name}`, { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: tess }, this.scene);
    m.position.set(x, y, z);
    m.material = mat;
    this.push(mat, m);
    return m;
  }
  sph(mat: StandardMaterial, d: number, x: number, y: number, z: number, squashY = 1): Mesh {
    const m = MeshBuilder.CreateSphere(`gz-${mat.name}`, { diameter: d, segments: 3 }, this.scene);
    m.position.set(x, y, z);
    m.scaling.y = squashY;
    m.material = mat;
    this.push(mat, m);
    return m;
  }
  flush(): void {
    for (const [name, g] of this.groups) {
      if (g.meshes.length === 0) continue;
      try {
        // MergeMeshes already applies each source's current world matrix;
        // pre-baking here double-transformed every vertex (proven by census:
        // the roof tank landed at 2x its designed position). Do NOT bake.
        const merged = Mesh.MergeMeshes(g.meshes, true, false, undefined, false, false);
        if (merged) {
          merged.name = `gz-merged-${name}`;
          merged.receiveShadows = true;
          continue;
        }
      } catch {
        // Fall through: keep individual meshes.
      }
      for (const m of g.meshes) m.receiveShadows = true;
    }
    this.groups.clear();
  }
}

export interface GzMaterials {
  concrete: StandardMaterial; concreteDark: StandardMaterial;
  teal: StandardMaterial; asphalt: StandardMaterial; paver: StandardMaterial;
  glassDark: StandardMaterial; glassWarm: StandardMaterial; glassSmall: StandardMaterial;
  hazard: StandardMaterial; trimWhite: StandardMaterial;
  accentWarm: StandardMaterial; pipeGray: StandardMaterial;
  leafA: StandardMaterial; leafB: StandardMaterial; trunk: StandardMaterial;
  tireDark: StandardMaterial; vehicleWhite: StandardMaterial;
  hazeClone: StandardMaterial; bgFlat: StandardMaterial;
}

// ---------------------------------------------------------------------------
// Pass 2: procedural canvas textures (original artwork for this project;
// technique adapted from A Letter to Summer, MIT, see file header).
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function gzCanvas(scene: Scene, name: string, size: number, draw: (ctx: Ctx, n: number, rnd: () => number) => void, seed: number): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as Ctx;
  draw(ctx, size, gzRandom(seed));
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

function speckle(ctx: Ctx, n: number, rnd: () => number, count: number, light: string, dark: string, maxA: number, maxS: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rnd() > 0.5 ? light : dark;
    ctx.globalAlpha = 0.05 + rnd() * maxA;
    const s = 1 + rnd() * maxS;
    ctx.fillRect(rnd() * n, rnd() * n, s, s * (0.6 + rnd() * 0.8));
  }
  ctx.globalAlpha = 1;
}

function applyGreenZoneTextures(scene: Scene, m: GzMaterials): void {
  const concrete = gzCanvas(scene, "gz-tex-concrete", 256, (ctx, n, rnd) => {
    ctx.fillStyle = "#9a9da0"; ctx.fillRect(0, 0, n, n);
    speckle(ctx, n, rnd, 2600, "#b9bcbe", "#6f7276", 0.25, 3);
    ctx.strokeStyle = "rgba(90,93,96,0.35)";
    for (let i = 0; i < 7; i++) { // weather streaks
      ctx.lineWidth = 2 + rnd() * 5;
      const x = rnd() * n;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rnd() - 0.5) * 30, n); ctx.stroke();
    }
  }, 101);
  m.concrete.diffuseTexture = concrete;
  m.concrete.diffuseColor = new Color3(0.82, 0.83, 0.84);

  const concreteDark = gzCanvas(scene, "gz-tex-concrete-dark", 256, (ctx, n, rnd) => {
    ctx.fillStyle = "#626568"; ctx.fillRect(0, 0, n, n);
    speckle(ctx, n, rnd, 2200, "#7d8083", "#43464a", 0.3, 3);
  }, 102);
  m.concreteDark.diffuseTexture = concreteDark;
  m.concreteDark.diffuseColor = new Color3(0.85, 0.85, 0.87);

  const asphalt = gzCanvas(scene, "gz-tex-asphalt", 256, (ctx, n, rnd) => {
    ctx.fillStyle = "#3a3d42"; ctx.fillRect(0, 0, n, n);
    speckle(ctx, n, rnd, 3200, "#54575e", "#232529", 0.35, 2.5);
  }, 103);
  m.asphalt.diffuseTexture = asphalt;
  m.asphalt.diffuseColor = new Color3(0.9, 0.9, 0.92);

  const paver = gzCanvas(scene, "gz-tex-paver", 256, (ctx, n, rnd) => {
    ctx.fillStyle = "#8f8b83"; ctx.fillRect(0, 0, n, n);
    speckle(ctx, n, rnd, 1800, "#a5a19a", "#6e6a63", 0.3, 3);
    ctx.strokeStyle = "rgba(70,67,62,0.8)"; ctx.lineWidth = 3; // paver joints
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo((i * n) / 2, 0); ctx.lineTo((i * n) / 2, n); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * n) / 2); ctx.lineTo(n, (i * n) / 2); ctx.stroke();
    }
  }, 104);
  paver.uScale = 10; paver.vScale = 11;
  m.paver.diffuseTexture = paver;
  m.paver.diffuseColor = new Color3(0.95, 0.94, 0.9);

  const teal = gzCanvas(scene, "gz-tex-teal", 256, (ctx, n, rnd) => {
    ctx.fillStyle = "#2e6f72"; ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 90; i++) { // brushed painted metal
      ctx.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
      ctx.fillRect(rnd() * n, 0, 1 + rnd() * 2, n);
    }
    speckle(ctx, n, rnd, 500, "#4a8b8d", "#1d4a4c", 0.25, 3);
  }, 105);
  m.teal.diffuseTexture = teal;
  m.teal.diffuseColor = new Color3(0.95, 0.97, 0.97);

  const glass = gzCanvas(scene, "gz-tex-glass", 256, (ctx, n, rnd) => {
    ctx.fillStyle = "#1c2f3a"; ctx.fillRect(0, 0, n, n);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const lit = rnd() < 0.22;
      ctx.fillStyle = lit ? "#c98f4e" : `rgb(${28 + rnd() * 14},${48 + rnd() * 16},${62 + rnd() * 18})`;
      ctx.fillRect(x * 64 + 5, y * 64 + 5, 54, 54);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x * 64 + 5, y * 64 + 5, 54, 10);
    }
  }, 106);
  glass.uScale = 3; glass.vScale = 2;
  m.glassDark.diffuseTexture = glass;
  m.glassDark.diffuseColor = new Color3(1, 1, 1);
  m.glassDark.emissiveColor = new Color3(0.25, 0.22, 0.16);
  // Small punched windows show the full grid per opening: sparser lit cells.
  const glassSmall = gzCanvas(scene, "gz-tex-glass-small", 256, (ctx, n, rnd) => {
    ctx.fillStyle = "#1c2f3a"; ctx.fillRect(0, 0, n, n);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const lit = rnd() < 0.08;
      ctx.fillStyle = lit ? "#c98f4e" : `rgb(${28 + rnd() * 14},${48 + rnd() * 16},${62 + rnd() * 18})`;
      ctx.fillRect(x * 64 + 5, y * 64 + 5, 54, 54);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x * 64 + 5, y * 64 + 5, 54, 10);
    }
  }, 110);
  m.glassSmall.diffuseTexture = glassSmall;

  const hazard = gzCanvas(scene, "gz-tex-hazard", 128, (ctx, n) => {
    ctx.fillStyle = "#c99a2e"; ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = "#23242a";
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + 32, 0);
      ctx.lineTo(i * 32, n); ctx.lineTo(i * 32 - 32, n);
      ctx.fill();
    }
  }, 107);
  hazard.uScale = 6; hazard.vScale = 1;
  m.hazard.diffuseTexture = hazard;
  m.hazard.diffuseColor = new Color3(1, 1, 1);
  m.hazard.emissiveColor = new Color3(0.12, 0.08, 0.01);
}

/** Canvas-painted sign board (original artwork). Own mesh + material. */
export function gzSign(scene: Scene, text: string, sub: string, w: number,
  bg = "#20363b", fg = "#f2e8c8", accent = "#e09a3c"): Mesh {
  const tex = new DynamicTexture(`gz-sign-${text}`, { width: 512, height: 192 }, scene, false);
  const ctx = tex.getContext() as Ctx;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = accent; ctx.lineWidth = 8; ctx.strokeRect(10, 10, 492, 172);
  ctx.fillStyle = fg; ctx.textAlign = "center";
  ctx.font = "bold 56px sans-serif";
  ctx.fillText(text, 256, 92);
  ctx.font = "30px sans-serif";
  ctx.fillStyle = accent;
  ctx.fillText(sub, 256, 148);
  tex.update(false);
  tex.hasAlpha = false;
  const mat = new StandardMaterial(`gz-signm-${text}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = new Color3(0.35, 0.3, 0.22);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  const mesh = MeshBuilder.CreatePlane(`gz-sign-${text}`, { width: w, height: (w * 192) / 512 }, scene);
  mesh.material = mat;
  return mesh;
}

// Sky dome shader (gradient + sun glow; GLSL approach adapted from
// A Letter to Summer, MIT, reimplemented for Babylon ShaderMaterial).
function buildSky(scene: Scene, sunDir: Vector3): void {
  const skyMat = new ShaderMaterial("gz-sky", scene, {
    vertexSource: `precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
    fragmentSource: `precision highp float;
      varying vec3 vDir;
      uniform vec3 sunDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 top = vec3(0.19, 0.47, 0.75);
        vec3 horizon = vec3(0.83, 0.90, 0.91);
        vec3 c = mix(horizon, top, smoothstep(0.0, 0.6, d.y));
        c = mix(vec3(0.55, 0.60, 0.62), c, smoothstep(-0.15, 0.02, d.y));
        float glow = pow(max(0.0, dot(d, normalize(sunDir))), 24.0);
        c += vec3(1.0, 0.85, 0.6) * glow * 0.55;
        float haze = 1.0 - smoothstep(0.0, 0.28, abs(d.y - 0.03));
        c = mix(c, horizon, haze * 0.45);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }, { attributes: ["position"], uniforms: ["worldViewProjection", "sunDir"], needAlphaBlending: false });
  skyMat.setVector3("sunDir", sunDir);
  skyMat.backFaceCulling = false;
  const dome = MeshBuilder.CreateSphere("gz-sky", { diameter: 760, segments: 4 }, scene);
  dome.material = skyMat;
  dome.isPickable = false;
  dome.infiniteDistance = true;
}

function buildClouds(scene: Scene): void {
  // Crossed alpha planes with a synchronous canvas texture (SpriteManager
  // data-URL textures rendered as opaque black squares — not used).
  const tex = gzCanvas(scene, "gz-tex-cloud", 256, (ctx, n, rnd) => {
    ctx.clearRect(0, 0, n, n);
    for (let i = 0; i < 26; i++) {
      const x = n * 0.2 + rnd() * n * 0.6;
      const y = n * 0.35 + rnd() * n * 0.3;
      const r = 18 + rnd() * 42;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }, 108);
  const mat = new StandardMaterial("gz-cloud", scene);
  mat.diffuseTexture = tex;
  // Opacity from the red channel (white blobs on black): deterministic,
  // unlike diffuse-alpha which rendered opaque black squares.
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  const rnd2 = gzRandom(77);
  const defs: [number, number, number][] = [[-120, 95, -160], [60, 110, -190], [170, 85, -60], [-170, 100, 40]];
  for (const [x, y, z] of defs) {
    const sc = 0.8 + rnd2() * 0.7;
    const w = 95 * sc, h = 34 * sc;
    const jx = x + (rnd2() - 0.5) * 30;
    // Crossed pair; alpha planes are excluded from the opaque merge batch.
    for (const ry of [0.3, 0.3 + Math.PI / 2]) {
      const p = MeshBuilder.CreatePlane("gz-cloud", { width: w, height: h }, scene);
      p.position.set(jx, y, z);
      p.rotation.y = ry;
      p.material = mat;
      p.isPickable = false;
    }
  }
}

function buildMaterials(scene: Scene): GzMaterials {
  // Flat base colors first; the materials pass adds canvas texture detail.
  return {
    concrete: gzMat(scene, "gz-concrete", new Color3(0.52, 0.54, 0.56)),
    concreteDark: gzMat(scene, "gz-concrete-dark", new Color3(0.34, 0.35, 0.38)),
    teal: gzMat(scene, "gz-teal", new Color3(0.2, 0.47, 0.49), new Color3(0.03, 0.09, 0.1)),
    asphalt: gzMat(scene, "gz-asphalt", new Color3(0.16, 0.17, 0.2)),
    paver: gzMat(scene, "gz-paver", new Color3(0.45, 0.44, 0.42)),
    glassDark: gzMat(scene, "gz-glass-dark", new Color3(0.12, 0.2, 0.26), new Color3(0.04, 0.08, 0.1)),
    glassWarm: gzMat(scene, "gz-glass-warm", new Color3(0.55, 0.42, 0.25), new Color3(0.75, 0.5, 0.2)),
    glassSmall: gzMat(scene, "gz-glass-small", new Color3(1, 1, 1), new Color3(0.22, 0.2, 0.15)),
    hazard: gzMat(scene, "gz-hazard", new Color3(0.85, 0.62, 0.1), new Color3(0.3, 0.18, 0.02)),
    trimWhite: gzMat(scene, "gz-trim", new Color3(0.78, 0.79, 0.78)),
    accentWarm: gzMat(scene, "gz-accent-warm", new Color3(1, 0.62, 0.25), new Color3(0.9, 0.45, 0.12)),
    pipeGray: gzMat(scene, "gz-pipe", new Color3(0.38, 0.42, 0.44)),
    leafA: gzMat(scene, "gz-leaf-a", new Color3(0.2, 0.42, 0.22)),
    leafB: gzMat(scene, "gz-leaf-b", new Color3(0.32, 0.52, 0.26)),
    trunk: gzMat(scene, "gz-trunk", new Color3(0.32, 0.25, 0.18)),
    tireDark: gzMat(scene, "gz-tire", new Color3(0.08, 0.08, 0.1)),
    vehicleWhite: gzMat(scene, "gz-vehicle", new Color3(0.75, 0.78, 0.76)),
    hazeClone: gzMat(scene, "gz-haze", new Color3(0.62, 0.7, 0.76)),
    // Background towers stay flat: the shared window texture would stretch
    // into giant cells across merged distant boxes. Fog does the depth work.
    bgFlat: gzMat(scene, "gz-bgflat", new Color3(0.58, 0.66, 0.72)),
  };
}

function addCollider(colliders: AABB[], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
  colliders.push({
    min: new Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    max: new Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  });
}

/** Solid mass driven by layout data: visible box + matching collider. */
function solid(b: GzBatch, mats: GzMaterials, colliders: AABB[], name: string,
  cx: number, cy: number, cz: number, sx: number, sy: number, sz: number,
  mat: StandardMaterial): void {
  void name;
  b.box(mat, sx, sy, sz, cx, cy, cz);
  addCollider(colliders, cx, cy, cz, sx, sy, sz);
}

// ---------------------------------------------------------------------------
// Pass 1: architectural composition.
// ---------------------------------------------------------------------------

function buildGround(b: GzBatch, m: GzMaterials): void {
  // Walkable tops stay flush (<=0.03): the controller plane is y=0 and feet
  // must not sink visibly into dressing. Sidewalk steps live at lane edges.
  b.box(m.paver, 30, 0.04, 34, 0, 0, 3);
  // Border trim + faded lane dashes.
  b.box(m.trimWhite, 30, 0.02, 0.25, 0, 0.01, -13.5);
  b.box(m.trimWhite, 30, 0.02, 0.25, 0, 0.01, 19.5);
  for (const dz of [-6, 0, 6, 12]) b.box(m.trimWhite, 2.2, 0.02, 0.3, 0, 0.01, dz);
  // Sidewalks along both facades with curb edges.
  for (const sx of [-1, 1]) {
    b.box(m.concreteDark, 3.5, 0.1, 34, sx * 13.2, 0.05, 3);
    b.box(m.concrete, 0.3, 0.16, 34, sx * 11.4, 0.08, 3);
  }
  // Alley lane dressing (darker asphalt patch + drain).
  b.box(m.asphalt, 7, 0.04, 12, -27.5, 0, 20);
  b.box(m.concreteDark, 0.5, 0.04, 0.9, -27.5, 0, 24);
  // Manholes on the court.
  for (const [mx, mz] of [[-6, 2], [7, -4]] as [number, number][]) {
    b.cyl(m.concreteDark, 0.04, 1, 1, mx, 0, mz, 16);
  }
}

function buildBuildingWest(b: GzBatch, m: GzMaterials, colliders: AABB[], rnd: () => number): void {
  void rnd;
  // Mass matches gz-bldW collider (face at x = -15).
  solid(b, m, colliders, "gz-bldW", -17, 4.5, 2, 4, 9, 36, m.concrete);
  // Pilaster strips + weathered base on the courtyard face.
  for (let z = -16; z <= 20; z += 6) b.box(m.concreteDark, 0.35, 9, 0.9, -14.85, 4.5, z);
  b.box(m.concreteDark, 0.3, 1, 36, -14.9, 0.5, 2);
  // Ground floor: maintenance doors, cabinets, conduit pipes.
  for (const dz of [-8, 6]) {
    b.box(m.pipeGray, 0.25, 3.2, 1.8, -14.9, 1.6, dz); // door inset
    b.box(m.concreteDark, 0.35, 0.3, 2.2, -14.9, 3.35, dz); // lintel
  }
  for (let i = 0; i < 3; i++) {
    const z = -2 + i * 1.1;
    b.box(m.pipeGray, 0.5, 1.4, 0.8, -14.75, 0.9, z); // elec cabinets
    b.box(m.accentWarm, 0.1, 0.12, 0.5, -14.5, 1.45, z); // pilot lamp
  }
  for (const pz of [-12, 0, 12]) b.cyl(m.pipeGray, 9, 0.28, 0.28, -14.7, 4.5, pz, 8); // conduits
  // Upper window bands (concrete frames + sparse-cell glass; two warm-lit).
  for (const wy of [5.6, 7.6]) {
    for (let z = -13; z <= 17; z += 6) {
      b.box(m.concreteDark, 0.2, 1.5, 2.2, -14.92, wy, z);
      const warm = (wy > 7 && (z === -1 || z === 11));
      b.box(warm ? m.glassWarm : m.glassSmall, 0.14, 1.1, 1.8, -14.86, wy, z);
    }
  }
  // Roofline: parapet, water tank, AC boxes, antenna mast.
  b.box(m.concreteDark, 4.4, 0.6, 36.4, -17, 9.3, 2);
  b.cyl(m.pipeGray, 3, 3, 3, -17, 10.8, -6, 12);
  b.cyl(m.concreteDark, 0.4, 3.4, 3.4, -17, 9.4, -6, 12);
  for (const [ax, az] of [[-17.5, 4], [-16.2, 12]] as [number, number][]) {
    b.box(m.pipeGray, 1.2, 0.8, 1, ax, 9.9, az);
  }
  b.cyl(m.pipeGray, 6, 0.12, 0.12, -16, 12, 14, 6);
  b.box(m.pipeGray, 1, 0.12, 0.12, -16, 14.4, 14);
  b.sph(m.accentWarm, 0.22, -16, 15, 14); // mast tip
  // Moss weathering at the base (Sewage echo, restrained).
  for (const mz of [-10, 2, 14]) b.box(m.leafA, 0.12, 0.5, 2.4, -14.82, 0.28, mz);
  // Coherent side faces (north/south ends).
  for (const ez of [-16, 20]) {
    b.box(m.concreteDark, 4.2, 1.5, 0.2, -17, 6.6, ez + (ez < 0 ? 0.05 : -0.05));
    b.box(m.glassSmall, 3.4, 1.1, 0.14, -17, 6.6, ez + (ez < 0 ? 0.05 : -0.05));
  }
}

function buildBuildingEast(b: GzBatch, m: GzMaterials, colliders: AABB[], rnd: () => number): void {
  void rnd;
  // Mass matches gz-bldE collider (face at x = 15).
  solid(b, m, colliders, "gz-bldE", 17, 5.5, 2, 4, 11, 36, m.concrete);
  // Teal frame: band courses + vertical fins (City Street echo).
  for (const by of [3.4, 7, 10.2]) b.box(m.teal, 0.4, 0.5, 36, 14.85, by, 2);
  for (let z = -16; z <= 20; z += 6) b.box(m.teal, 0.4, 11, 0.7, 14.85, 5.5, z);
  // Storefront (z 2..10): recessed opening, glass, warm interior, sign board.
  b.box(m.glassDark, 0.3, 2.8, 8, 14.9, 1.6, 6);
  b.box(m.glassWarm, 0.2, 2.2, 7.4, 14.82, 1.4, 6); // lit interior
  b.box(m.teal, 0.5, 0.6, 8.6, 14.85, 3.3, 6); // sign band (canvas in detail pass)
  b.box(m.pipeGray, 0.9, 0.18, 2, 14.4, 0.09, 6); // entry step
  // Upper glass strips with mullions.
  for (const wy of [5.6, 8.4]) {
    b.box(m.glassDark, 0.2, 1.6, 30, 14.9, wy, 2);
    for (let z = -11; z <= 15; z += 4) b.box(m.teal, 0.24, 1.7, 0.25, 14.9, wy, z);
  }
  // Rooftop: railing, AC, billboard frame (art in detail pass).
  b.box(m.teal, 4, 0.9, 0.25, 17, 11.4, -15.5);
  b.box(m.pipeGray, 1.4, 1, 1.2, 16.5, 11.5, 8);
  for (const px of [15.2, 18.8]) b.box(m.pipeGray, 0.3, 4, 0.3, px, 13, -8);
  b.box(m.concreteDark, 4.2, 2.4, 0.3, 17, 15, -8); // billboard back
  // Coherent side faces.
  for (const ez of [-16, 20]) {
    b.box(m.teal, 4.2, 0.5, 0.25, 17, 7, ez + (ez < 0 ? 0.08 : -0.08));
    b.box(m.glassSmall, 3, 1.4, 0.2, 17, 5.4, ez + (ez < 0 ? 0.08 : -0.08));
  }
}

function buildWalkwayDress(b: GzBatch, m: GzMaterials): void {
  // Teal pier cladding over the existing pillars (colliders unchanged).
  for (const px of [-36, -18, 0, 18, 36]) {
    b.box(m.teal, 1.9, 5.7, 1.9, px, 2.85, -35);
    b.box(m.hazard, 1.95, 0.5, 1.95, px, 0.6, -35); // base stripe
  }
  // Cross-bracing high between piers (above head height, visual only).
  for (const px of [-27, -9, 9, 27]) {
    const brace = b.box(m.teal, 16.5, 0.35, 0.35, px, 4.1, -35);
    brace.rotation.z = 0.18;
    const brace2 = b.box(m.teal, 16.5, 0.35, 0.35, px, 4.1, -35);
    brace2.rotation.z = -0.18;
  }
  // Under-deck utility pipe + hanging lamp discs (emissive only).
  const deckPipe = b.cyl(m.pipeGray, 80, 0.35, 0.35, 0, 4.6, -35, 8);
  deckPipe.rotation.z = Math.PI / 2;
  for (let x = -35; x <= 35; x += 10) {
    b.cyl(m.accentWarm, 0.08, 0.5, 0.5, x, 4.25, -35, 8);
  }
  // Railing posts (instanced-look via batch) + double rails, both deck edges.
  for (const rz of [-39.55, -30.45]) {
    for (let x = -39; x <= 39; x += 2) b.box(m.pipeGray, 0.12, 1.1, 0.12, x, 6.55, rz);
    b.box(m.teal, 80, 0.09, 0.14, 0, 7.12, rz);
    b.box(m.pipeGray, 80, 0.07, 0.1, 0, 6.7, rz);
  }
  // Hazard deck fascia on the courtyard side.
  b.box(m.hazard, 80, 0.4, 0.12, 0, 5.75, -29.95);
  // Deck-corner bollards (visual only, clear of the ramp route).
  for (const [bx, bz] of [[-40.5, -29.5], [-40.5, -40.5], [40.5, -29.5], [40.5, -40.5]] as [number, number][]) {
    b.cyl(m.hazard, 0.9, 0.3, 0.3, bx, 6.45, bz, 8);
  }
}

function buildAlley(b: GzBatch, m: GzMaterials, colliders: AABB[]): void {
  // Annex block matches gz-annex collider; maintenance face east.
  solid(b, m, colliders, "gz-annex", -34.5, 2.5, 20, 5, 5, 12, m.concreteDark);
  b.box(m.pipeGray, 0.3, 2.6, 1.6, -31.9, 1.3, 20); // door
  b.box(m.accentWarm, 0.15, 0.9, 0.5, -31.85, 2.2, 22.6); // wall lamp (warm)
  b.box(m.glassDark, 0.2, 0.9, 0.9, -31.9, 3.6, 17.5); // high windows
  b.box(m.glassDark, 0.2, 0.9, 0.9, -31.9, 3.6, 22.5);
  b.box(m.concrete, 5.4, 0.4, 12.4, -34.5, 5.2, 20); // roof cap
  b.cyl(m.pipeGray, 1.2, 0.5, 0.5, -34, 5.9, 18, 8); // roof vent
  // Guide stubs match gz-alleyN/S colliders; hazard caps invite entry.
  solid(b, m, colliders, "gz-alleyN", -24, 1, 15.5, 0.6, 2, 3, m.concrete);
  solid(b, m, colliders, "gz-alleyS", -24, 1, 24.5, 0.6, 2, 3, m.concrete);
  b.box(m.hazard, 0.7, 0.25, 3.1, -24, 2.1, 15.5);
  b.box(m.hazard, 0.7, 0.25, 3.1, -24, 2.1, 24.5);
  // Canopy over the lane on two posts (bottom edge at 3.0 clears play).
  b.box(m.teal, 7, 0.15, 8, -28, 3.05, 20);
  b.box(m.pipeGray, 0.25, 3, 0.25, -31, 1.5, 16.5);
  b.box(m.pipeGray, 0.25, 3, 0.25, -31, 1.5, 23.5);
  b.box(m.accentWarm, 1.6, 0.1, 0.4, -28, 2.95, 20); // canopy light bar
}

function buildRelayInstall(b: GzBatch, m: GzMaterials, colliders: AABB[]): void {
  // Equipment pad + cabinets match gz-cabW/E colliders.
  b.cyl(m.concreteDark, 0.06, 9, 9, 0, 0, -8, 24);
  for (const sx of [-1, 1]) {
    solid(b, m, colliders, sx < 0 ? "gz-cabW" : "gz-cabE", sx * 6.5, 1, -8, 1.4, 2, 1, m.teal);
    b.box(m.accentWarm, 1.2, 0.12, 0.06, sx * 6.5, 1.85, -7.48); // status strip
    b.box(m.pipeGray, 0.9, 0.5, 0.06, sx * 6.5, 0.6, -7.48); // vent
  }
  // Low pipe runs toward the tower (visual only, below knee).
  for (const [pz, pd] of [[-7.4, 0.16], [-8, 0.12], [-8.6, 0.16]] as [number, number][]) {
    const p = b.cyl(m.pipeGray, 13, pd * 2, pd * 2, 0, 0.3, pz, 8);
    p.rotation.z = Math.PI / 2;
  }
  // Antenna mast + dish on the existing tower (visual).
  b.cyl(m.pipeGray, 5, 0.18, 0.24, 0, 18.5, -8, 8);
  b.box(m.pipeGray, 1.6, 0.1, 0.1, 0, 20.4, -8);
  const dish = b.sph(m.pipeGray, 1.2, 0.9, 19.6, -8);
  dish.scaling.set(1, 1, 0.35);
  b.sph(m.accentWarm, 0.3, 0, 21.1, -8); // mast tip
}

function buildBackground(b: GzBatch, m: GzMaterials, rnd: () => number): void {
  // Layered skyline: flat-shaded towers with darker caps (texture in pass 2).
  const rows: { z?: number; x?: number; n: number; vertical: boolean }[] = [
    { z: -80, n: 11, vertical: false },
    { x: 82, n: 6, vertical: true },
    { x: -82, n: 6, vertical: true },
    { z: 76, n: 6, vertical: false },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = (i / (row.n - 1) - 0.5) * 120;
      const w = 8 + rnd() * 7;
      const h = row.z === 76 ? 8 + rnd() * 8 : 15 + rnd() * 20;
      const d = 8 + rnd() * 6;
      const x = row.vertical ? (row.x ?? 0) + (rnd() - 0.5) * 8 : t;
      const z = row.vertical ? t : (row.z ?? 0) + (rnd() - 0.5) * 8;
      b.box(m.bgFlat, w, h, d, x, h / 2, z);
      b.box(m.bgFlat, w + 0.6, 1.2, d + 0.6, x, h + 0.4, z);
    }
  }
  // Stadium dome landmark (DisuseBuild echo) north-west.
  b.cyl(m.trimWhite, 8, 24, 26, -48, 4, -72, 20);
  const dome = b.sph(m.trimWhite, 24, -48, 8, -72);
  dome.scaling.y = 0.45;
  // Overhead transit beam (City Street echo) on two piers (colliders in layout).
  b.box(m.concreteDark, 124, 3, 4.5, 0, 14.5, -52);
  b.box(m.teal, 124, 0.5, 4.7, 0, 12.9, -52);
  // Tower crane silhouette north-east.
  const craneMat = m.concreteDark;
  b.box(craneMat, 1.6, 42, 1.6, 58, 21, -68);
  b.box(craneMat, 26, 1.4, 1.4, 50, 41.5, -68);
  b.box(craneMat, 8, 1.4, 1.4, 68, 41.5, -68);
  b.box(craneMat, 0.15, 12, 0.15, 40, 35, -68);
}

/** One 1024px shadow map off the courtyard sun (fixed frustum, cheap). */
function buildGreenZoneShadows(scene: Scene): void {
  // Dev A/B hook (?noshadow=1): perf comparisons, never shipped on.
  try {
    if (new URLSearchParams(location.search).get("noshadow") === "1") return;
  } catch { /* non-browser (tests): fall through to normal setup */ }
  try {
    const dir = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
    if (!dir) return;
    const sg = new ShadowGenerator(1024, dir);
    sg.bias = 0.003;
    sg.normalBias = 0.1;
    for (const m of scene.meshes) {
      if (m.name.startsWith("gz-merged-")) sg.addShadowCaster(m);
    }
  } catch {
    // Software renderers or old paths: the slice stays lit without shadows.
  }
}

// ---------------------------------------------------------------------------
// Pass 3: selective detail + vegetation (signage canvases are original art).
// ---------------------------------------------------------------------------

function buildDetail(scene: Scene, b: GzBatch, m: GzMaterials, rnd: () => number): void {
  // Storefront + alley + relay signs.
  const s1 = gzSign(scene, "FIELD SERVICE", "REPAIR • PARTS • RECHARGE", 7);
  s1.position.set(14.55, 3.3, 6); s1.rotation.y = -Math.PI / 2;
  const s2 = gzSign(scene, "STORAGE 03", "AUTHORIZED CREWS", 3.4);
  s2.position.set(-31.9, 3.4, 20); s2.rotation.y = Math.PI / 2;
  const s3 = gzSign(scene, "RELAY 07", "KEEP CLEAR", 1.1);
  s3.position.set(5.79, 1.45, -8); s3.rotation.y = -Math.PI / 2;
  // Rooftop billboard art (abstract district motif, original).
  const bb = gzCanvas(scene, "gz-billboard", 512, (ctx, n, r2) => {
    const g = ctx.createLinearGradient(0, 0, 0, n);
    g.addColorStop(0, "#274b52"); g.addColorStop(1, "#101d20");
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = "#e09a3c";
    ctx.beginPath(); ctx.arc(n * 0.7, n * 0.36, n * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2e6f72";
    for (let i = 0; i < 7; i++) {
      const w = 20 + r2() * 60;
      ctx.fillRect(r2() * n, n * 0.62, w, n * 0.38);
    }
    ctx.fillStyle = "#f2e8c8"; ctx.textAlign = "center";
    ctx.font = "bold 64px sans-serif";
    ctx.fillText("GREEN ZONE", n / 2, n * 0.52);
  }, 109);
  const bbMat = new StandardMaterial("gz-billboard", scene);
  bbMat.diffuseTexture = bb;
  bbMat.emissiveColor = new Color3(0.3, 0.28, 0.22);
  const bbMesh = MeshBuilder.CreatePlane("gz-billboard", { width: 4, height: 2.2 }, scene);
  bbMesh.position.set(17, 15, -7.83);
  bbMesh.material = bbMat;
  // North face copy: single-sided planes read mirrored from behind.
  const bbNorth = MeshBuilder.CreatePlane("gz-billboard-n", { width: 4, height: 2.2 }, scene);
  bbNorth.position.set(17, 15, -8.17);
  bbNorth.rotation.y = Math.PI;
  bbNorth.material = bbMat;
  // Planter shrubs (3 blobs each; unite with the layout boxes).
  // Lane planters sit on the 0.1-high sidewalk: box bottoms lifted to match.
  for (const [px, pz] of [[-13.5, -6], [-13.5, 10], [13.5, -6], [13.5, 10], [-27.5, 25.8]] as [number, number][]) {
    const lift = pz === 25.8 ? 0 : 0.1;
    b.sph(rnd() > 0.5 ? m.leafA : m.leafB, 1.1, px - 0.3, 1.15 + lift, pz, 0.85);
    b.sph(rnd() > 0.5 ? m.leafB : m.leafA, 0.9, px + 0.35, 1.05 + lift, pz + 0.2, 0.9);
    b.sph(m.leafA, 0.8, px + 0.1, 1.0 + lift, pz - 0.35, 0.9);
  }
  // Tree canopies over the pass-1 trunks.
  for (const [tx, tz] of [[-11, 22], [11, 22]] as [number, number][]) {
    b.sph(m.leafA, 2.6, tx, 3.6, tz, 0.9);
    b.sph(m.leafB, 2.0, tx - 1, 3.0, tz + 0.5, 0.95);
    b.sph(m.leafB, 1.8, tx + 1, 3.1, tz - 0.5, 0.95);
    b.cyl(m.concreteDark, 0.05, 1.6, 1.6, tx, 0, tz, 12); // root grate
  }
  // Parked service vehicle (axis-aligned by design; collider in layout).
  const vx = 23, vz = 8;
  for (const wx of [vx - 1, vx + 1]) for (const wz of [vz - 1.6, vz, vz + 1.6]) {
    const wheel = b.cyl(m.tireDark, 0.3, 0.9, 0.9, wx, 0.45, wz, 12);
    wheel.rotation.z = Math.PI / 2;
  }
  b.box(m.vehicleWhite, 2.2, 0.5, 5, vx, 0.85, vz); // chassis
  b.box(m.vehicleWhite, 2.2, 1.3, 1.8, vx, 1.75, vz + 1.6); // cab (south end)
  b.box(m.glassDark, 2.0, 0.6, 0.15, vx, 1.95, vz + 2.45); // windshield
  b.box(m.vehicleWhite, 0.15, 0.8, 3, vx - 1.02, 1.5, vz - 0.8); // bed walls
  b.box(m.vehicleWhite, 0.15, 0.8, 3, vx + 1.02, 1.5, vz - 0.8);
  b.box(m.vehicleWhite, 2.2, 0.8, 0.15, vx, 1.5, vz - 2.3);
  b.box(m.teal, 2.24, 0.25, 5.04, vx, 1.05, vz); // livery stripe
  // Bins + streetlights (visual only — thin/edge-placed, never snag).
  for (const [bx, bz] of [[-14.2, 14], [14.2, -10], [-25.5, 25.5]] as [number, number][]) {
    b.cyl(m.teal, 1.1, 0.9, 0.8, bx, 0.55, bz, 10);
    b.cyl(m.concreteDark, 0.08, 0.95, 0.95, bx, 1.12, bz, 10);
  }
  for (const [lx, lz, flip] of [[-13.5, 8, 1], [13.5, -10, -1]] as [number, number, number][]) {
    b.cyl(m.pipeGray, 5.2, 0.22, 0.28, lx, 2.6, lz, 8);
    const arm = b.box(m.pipeGray, 1.6, 0.12, 0.12, lx - flip * 0.8, 5.1, lz);
    void arm;
    b.box(m.trimWhite, 0.7, 0.18, 0.3, lx - flip * 1.5, 5.0, lz); // head (day-pale)
  }
}

export function buildGreenZone(scene: Scene, colliders: AABB[]): void {
  const rnd = gzRandom(20260908);
  const mats = buildMaterials(scene);
  applyGreenZoneTextures(scene, mats);
  // Daylight atmosphere: pale horizon fog for depth (game.ts owns the sun).
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0032;
  scene.fogColor = new Color3(0.78, 0.86, 0.89);
  scene.clearColor.set(0.78, 0.86, 0.89, 1);
  buildSky(scene, new Vector3(-0.45, 0.62, 0.34));
  buildClouds(scene);
  const b = new GzBatch(scene);
  buildGround(b, mats);
  buildBuildingWest(b, mats, colliders, rnd);
  buildBuildingEast(b, mats, colliders, rnd);
  buildWalkwayDress(b, mats);
  buildAlley(b, mats, colliders);
  buildRelayInstall(b, mats, colliders);
  buildBackground(b, mats, rnd);
  buildDetail(scene, b, mats, rnd);
  // Register layout colliders, adding visual masses for the ones without a
  // dedicated builder above (covers, planters, tree trunks, pier cladding).
  const built = new Set(["gz-bldW", "gz-bldE", "gz-annex", "gz-alleyN", "gz-alleyS", "gz-cabW", "gz-cabE"]);
  for (const s of GZ_SOLIDS) {
    if (!s.solid || built.has(s.name)) continue;
    const [cx, cy, cz, sx, sy, sz] = s.box;
    if (s.name === "gz-pierW" || s.name === "gz-pierE") {
      b.box(mats.teal, sx + 0.3, sy, sz + 0.3, cx, cy, cz); // pier cladding
    } else if (s.name === "gz-covW" || s.name === "gz-covE") {
      b.box(mats.concrete, sx, sy, sz, cx, cy, cz); // barrier block
      b.box(mats.hazard, 0.35, sy + 0.02, sz + 0.02, cx - sx / 2 + 0.2, cy, cz); // hazard end
      b.box(mats.hazard, 0.35, sy + 0.02, sz + 0.02, cx + sx / 2 - 0.2, cy, cz);
    } else if (s.name.startsWith("gz-plan")) {
      b.box(mats.concreteDark, sx, sy, sz, cx, cy + 0.1, cz); // planter box (on sidewalk)
      b.box(mats.trunk, sx - 0.3, 0.12, sz - 0.3, cx, cy + sy / 2 + 0.1, cz); // soil
    } else if (s.name === "gz-treeW" || s.name === "gz-treeE") {
      b.cyl(mats.trunk, 2.6, 0.4, 0.55, cx, 1.3, cz, 8); // trunk (canopy in pass 3)
    }
    addCollider(colliders, cx, cy, cz, sx, sy, sz);
  }
  b.flush();
  buildGreenZoneShadows(scene);
}
