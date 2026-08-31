import { z } from "zod";

// This module is deliberately browser-safe. Storage keys and credentials never
// cross the API boundary; an asset's contents are immutable for its entire life.
export const BACKGROUND_ASSET_MAX_INPUT_BYTES = 3 * 1024 * 1024;
export const BACKGROUND_ASSET_MAX_INPUT_PIXELS = 20_000_000;
export const BACKGROUND_ASSET_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const BACKGROUND_ASSET_MAX_LISTED = 100;
export const BACKGROUND_ASSET_MAX_STORAGE_BYTES = 1024 ** 3;
export const BACKGROUND_ASSET_UPLOADS_PER_MINUTE = 10;
export const BACKGROUND_ASSET_WIDTH = 1080;
export const BACKGROUND_ASSET_HEIGHT = 1920;
export const BACKGROUND_ASSET_DRAFT_RETENTION_DAYS = 30;

export const backgroundAssetIdSchema = z.string().uuid().transform((id) => id.toLowerCase());

export type BackgroundAssetMetadata = {
  id: string;
  displayName: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
  imageUrl: string;
};

export type BackgroundAssetList = {
  assets: BackgroundAssetMetadata[];
  quota: {
    listedCount: number;
    pendingCount: number;
    maxListed: number;
    bytesUsed: number;
    maxBytes: number;
  };
};

export type BackgroundAssetUploadResult = {
  asset: BackgroundAssetMetadata;
  reused: boolean;
};

export function backgroundAssetImageUrl(assetId: string) {
  return `/api/background-assets/${backgroundAssetIdSchema.parse(assetId)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Only the existing config/document/snapshot background fields are traversed.
 * Do not treat unrelated user text containing an asset ID as a reference.
 */
export function collectBackgroundAssetIds(value: unknown): string[] {
  const root = record(value);
  if (!root) return [];
  const candidates = [
    root,
    record(root.background),
    record(record(root.config)?.background),
    record(record(root.overlays)?.background),
    record(record(record(record(root.template)?.snapshot)?.config)?.background),
  ];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (candidate?.kind !== "uploaded_image") continue;
    // Invalid IDs fail validation rather than silently skipping ownership checks.
    ids.add(backgroundAssetIdSchema.parse(candidate.assetId));
  }
  return [...ids].sort();
}
