import manifest from "./showcase-delivery.json";

export function showcaseAsset(id: string, kind: "video" | "poster") {
  const asset = (manifest.assets as Record<string, { video: string; poster: string }>)[id];
  if (!asset) throw new Error(`Unknown showcase asset: ${id}`);
  return `${manifest.origin}/${asset[kind]}`;
}
