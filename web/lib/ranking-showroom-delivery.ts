import manifest from "./ranking-showroom-delivery.json";

export function rankingShowroomVideo(locale: "ko" | "en" | "ja", name: string) {
  const asset = manifest.assets[`${locale}/${name}` as keyof typeof manifest.assets];
  if (!asset) throw new Error(`Missing ranking showcase: ${locale}/${name}`);
  return `${manifest.origin}/${asset.path}`;
}
