// Centralized asset registry. No character GLBs are bundled with this prototype,
// so every entry resolves to the stylized placeholder pipeline. Dropping a GLB
// into /public/assets/glb/<file> and flipping `placeholderOnly` to false is enough
// to try the real model (failures fall back to placeholders with a warning).
import type { Scene } from "@babylonjs/core/scene";

export interface AssetEntry {
  character: string;
  glb: string;
  placeholderOnly: boolean;
  idleClip?: string;
  moveClip?: string;
}

export const ASSET_REGISTRY: AssetEntry[] = [
  { character: "tololo", glb: "assets/glb/tololo.glb", placeholderOnly: true },
  { character: "qiongjiu", glb: "assets/glb/qiongjiu.glb", placeholderOnly: true },
  { character: "mosin", glb: "assets/glb/mosin.glb", placeholderOnly: true },
  { character: "sabrina", glb: "assets/glb/sabrina.glb", placeholderOnly: true },
  { character: "peritya", glb: "assets/glb/peritya.glb", placeholderOnly: true },
  { character: "vepley", glb: "assets/glb/vepley.glb", placeholderOnly: true },
];

export async function tryLoadCharacterAsset(scene: Scene, character: string): Promise<"placeholder" | "glb"> {
  const entry = ASSET_REGISTRY.find((a) => a.character === character);
  if (!entry || entry.placeholderOnly) return "placeholder";
  try {
    await import("@babylonjs/loaders/glTF");
    const { SceneLoader } = await import("@babylonjs/core/Loading/sceneLoader");
    await SceneLoader.ImportMeshAsync("", "/", entry.glb, scene);
    return "glb";
  } catch (err) {
    console.warn(`[assets] failed to load ${entry.glb}, using placeholder:`, err);
    return "placeholder";
  }
}
