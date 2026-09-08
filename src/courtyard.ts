// Green Zone courtyard art test (unapproved, local review only).
// Dresses the existing stage in place: one weathered façade, concrete/asphalt,
// teal painted metal, purposeful cover, emissive warm accents. No map expansion,
// no topology change — only small colliders for new solid cover/posts.
// References: GreenZone DisuseBuild / City Street / Sewage Day backgrounds.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AABB } from "./world";

function cmat(scene: Scene, name: string, color: Color3, emissive?: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  if (emissive) m.emissiveColor = emissive;
  m.specularColor = new Color3(0.08, 0.08, 0.1);
  return m;
}

function solid(scene: Scene, colliders: AABB[], name: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
  colliders.push({
    min: new Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    max: new Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  });
  void scene; void name;
}

export function dressCourtyard(scene: Scene, colliders: AABB[]): void {
  const concrete = cmat(scene, "cy-concrete", new Color3(0.42, 0.44, 0.46));
  const concreteDark = cmat(scene, "cy-concrete-dark", new Color3(0.3, 0.31, 0.34));
  const tealMetal = cmat(scene, "cy-teal", new Color3(0.16, 0.42, 0.44), new Color3(0.03, 0.1, 0.11));
  const asphalt = cmat(scene, "cy-asphalt", new Color3(0.09, 0.1, 0.13));
  const rustRed = cmat(scene, "cy-rust", new Color3(0.55, 0.2, 0.12), new Color3(0.12, 0.03, 0.01));
  const hazardYellow = cmat(scene, "cy-hazard", new Color3(0.95, 0.7, 0.1), new Color3(0.4, 0.26, 0.03));
  const warmGlow = cmat(scene, "cy-warm", new Color3(1, 0.62, 0.25), new Color3(1, 0.5, 0.15));
  const pipeGray = cmat(scene, "cy-pipe", new Color3(0.35, 0.4, 0.42));
  const boxGreen = cmat(scene, "cy-elecbox", new Color3(0.25, 0.35, 0.3));

  // --- façade treatment on the existing shortcut north wall (z = 24 face at z=23.5) ---
  for (const px of [-8.25, 8.25]) {
    const panel = MeshBuilder.CreateBox(`cy-panel-${px}`, { width: 9, height: 3, depth: 0.3 }, scene);
    panel.position = new Vector3(px, 1.8, 23.3);
    panel.material = concrete;
  }
  // weathered darker base strip
  const base = MeshBuilder.CreateBox("cy-base", { width: 24, height: 0.7, depth: 0.35 }, scene);
  base.position = new Vector3(0, 0.35, 23.28);
  base.material = concreteDark;
  // vertical pipes
  for (const px of [-13.2, 13.2]) {
    const pipe = MeshBuilder.CreateCylinder(`cy-pipe-${px}`, { height: 4.5, diameter: 0.36 }, scene);
    pipe.position = new Vector3(px, 2.25, 23.35);
    pipe.material = pipeGray;
  }
  // electrical boxes (DisuseBuild detail)
  for (const [i, px] of [[-5.5, -5.5], [5.5, 5.5], [11, 11]] as [number, number][]) {
    void i;
    const box = MeshBuilder.CreateBox(`cy-elec-${px}`, { width: 0.7, height: 1, depth: 0.4 }, scene);
    box.position = new Vector3(px, 1.6, 23.25);
    box.material = boxGreen;
  }
  // warm window strip (selective warm accent)
  const win = MeshBuilder.CreateBox("cy-warmwin", { width: 3, height: 0.5, depth: 0.12 }, scene);
  win.position = new Vector3(8.25, 3.2, 23.32);
  win.material = warmGlow;
  // red barrel + yellow scaffold rail beside the façade
  const barrel = MeshBuilder.CreateCylinder("cy-barrel", { height: 1.1, diameterTop: 0.9, diameterBottom: 0.9 }, scene);
  barrel.position = new Vector3(-11, 0.55, 22.2);
  barrel.material = rustRed;
  solid(scene, colliders, "cy-barrel", -11, 0.55, 22.2, 0.9, 1.1, 0.9);
  const rail = MeshBuilder.CreateBox("cy-scaffold", { width: 4, height: 0.12, depth: 0.12 }, scene);
  rail.position = new Vector3(-10, 2.6, 22.6);
  rail.material = hazardYellow;
  for (const px of [-12, -8]) {
    const post = MeshBuilder.CreateBox(`cy-scafpost-${px}`, { width: 0.12, height: 2.6, depth: 0.12 }, scene);
    post.position = new Vector3(px, 1.3, 22.6);
    post.material = hazardYellow;
  }

  // --- teal painted-metal canopy over the spawn→relay approach (City Street echo) ---
  for (const [px, pz] of [[-3, 4], [3, 4], [-3, -1], [3, -1]] as [number, number][]) {
    const post = MeshBuilder.CreateBox(`cy-canopy-${px}-${pz}`, { width: 0.35, height: 3.2, depth: 0.35 }, scene);
    post.position = new Vector3(px, 1.6, pz);
    post.material = tealMetal;
    solid(scene, colliders, `cy-canopy-${px}-${pz}`, px, 1.6, pz, 0.35, 3.2, 0.35);
  }
  const roof = MeshBuilder.CreateBox("cy-roof", { width: 7.4, height: 0.15, depth: 6.4 }, scene);
  roof.position = new Vector3(0, 3.3, 1.5);
  roof.material = tealMetal;
  const roofStrip = MeshBuilder.CreateBox("cy-roofstrip", { width: 7.4, height: 0.08, depth: 0.18 }, scene);
  roofStrip.position = new Vector3(0, 3.18, 4.6);
  roofStrip.material = warmGlow;
  // railing on the canopy roof edge (Sewage plant echo, visual only)
  const railTop = MeshBuilder.CreateBox("cy-canopy-rail", { width: 7.4, height: 0.08, depth: 0.08 }, scene);
  railTop.position = new Vector3(0, 4.1, -1.6);
  railTop.material = pipeGray;
  for (let i = 0; i < 8; i++) {
    const bal = MeshBuilder.CreateBox(`cy-canopy-bal-${i}`, { width: 0.07, height: 0.75, depth: 0.07 }, scene);
    bal.position = new Vector3(-3.5 + i, 3.72, -1.6);
    bal.material = pipeGray;
  }

  // --- asphalt dressing from spawn toward the relay (visual only) ---
  const strip = MeshBuilder.CreateGround("cy-asphalt-strip", { width: 8, height: 24 }, scene);
  strip.position = new Vector3(2, 0.015, 2);
  strip.material = asphalt;
  for (const ex of [-2.2, 6.2]) {
    const edge = MeshBuilder.CreateBox(`cy-edge-${ex}`, { width: 0.25, height: 0.02, depth: 24 }, scene);
    edge.position = new Vector3(ex, 0.03, 2);
    edge.material = concreteDark;
  }

  // --- purposeful cover inside the relay approach (real colliders) ---
  for (const px of [-5, 5]) {
    const barrier = MeshBuilder.CreateBox(`cy-cover-${px}`, { width: 2.2, height: 1.1, depth: 0.8 }, scene);
    barrier.position = new Vector3(px, 0.55, -2);
    barrier.material = concrete;
    solid(scene, colliders, `cy-cover-${px}`, px, 0.55, -2, 2.2, 1.1, 0.8);
    // hazard end caps (Sewage striping echo)
    for (const ex of [-0.9, 0.9]) {
      const cap = MeshBuilder.CreateBox(`cy-cap-${px}-${ex}`, { width: 0.35, height: 1.12, depth: 0.82 }, scene);
      cap.position = new Vector3(px + ex, 0.56, -2);
      cap.material = ex < 0 ? hazardYellow : concreteDark;
    }
  }
}
