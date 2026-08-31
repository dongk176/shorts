import {
  BACKGROUND_ASSET_MAX_INPUT_BYTES,
  BACKGROUND_ASSET_MAX_OUTPUT_BYTES,
  BACKGROUND_ASSET_WIDTH,
  BACKGROUND_ASSET_HEIGHT,
  backgroundAssetIdSchema,
  backgroundAssetImageUrl,
  type BackgroundAssetList,
  type BackgroundAssetMetadata,
  type BackgroundAssetUploadResult,
} from "@/lib/background-assets-contract";

export const BACKGROUND_ASSETS_CHANGED = "easycut-background-assets-changed";

export function validateBackgroundAssetUpload(file: Pick<File, "type" | "size">): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase())) {
    throw new Error("JPG·PNG·정지 WebP 이미지만 올릴 수 있습니다.");
  }
  if (file.size <= 0 || file.size > BACKGROUND_ASSET_MAX_INPUT_BYTES) {
    throw new Error("배경 이미지는 3MB 이하의 비어 있지 않은 파일로 올려 주세요.");
  }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  if (!response.ok || !body) {
    throw new Error(typeof body?.detail === "string" ? body.detail : "배경 이미지를 불러오지 못했습니다. 다시 시도해 주세요.");
  }
  return body;
}

function parseAsset(value: unknown): BackgroundAssetMetadata {
  if (!value || typeof value !== "object") throw new Error("배경 이미지 응답을 확인하지 못했습니다.");
  const asset = value as BackgroundAssetMetadata;
  const id = backgroundAssetIdSchema.parse(asset.id);
  if (typeof asset.displayName !== "string" || typeof asset.createdAt !== "string") {
    throw new Error("배경 이미지 응답을 확인하지 못했습니다.");
  }
  // Never follow an arbitrary URL returned in metadata, even on this authenticated API.
  return { ...asset, id, imageUrl: backgroundAssetImageUrl(id) };
}

export async function requestBackgroundAssetList(signal?: AbortSignal): Promise<BackgroundAssetList> {
  const body = await responseBody(await fetch("/api/background-assets", {
    cache: "no-store", credentials: "same-origin", signal,
  }));
  if (!Array.isArray(body.assets) || !body.quota || typeof body.quota !== "object") {
    throw new Error("내 배경 목록을 불러오지 못했습니다.");
  }
  return {
    assets: body.assets.map(parseAsset),
    quota: body.quota as BackgroundAssetList["quota"],
  };
}

export async function uploadBackgroundAsset(file: File, signal?: AbortSignal): Promise<BackgroundAssetUploadResult> {
  validateBackgroundAssetUpload(file);
  const data = new FormData();
  data.append("file", file);
  const body = await responseBody(await fetch("/api/background-assets", {
    method: "POST", body: data, credentials: "same-origin", signal,
  }));
  return { asset: parseAsset(body.asset), reused: body.reused === true };
}

export async function removeBackgroundAssetFromLibrary(assetId: string, signal?: AbortSignal): Promise<void> {
  const body = await responseBody(await fetch(backgroundAssetImageUrl(assetId), {
    method: "DELETE", credentials: "same-origin", signal,
  }));
  if (body.removed !== true || body.assetId !== assetId) {
    throw new Error("내 배경 목록에서 제거하지 못했습니다.");
  }
}

/** Check access and decode before replacing the current canvas background. */
export async function verifyBackgroundAssetSelection(assetId: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(backgroundAssetImageUrl(assetId), {
    cache: "no-store", credentials: "same-origin", signal,
  });
  if (!response.ok) {
    await responseBody(response);
    return;
  }
  const image = await response.blob();
  if (image.type !== "image/webp" || image.size === 0 || image.size > BACKGROUND_ASSET_MAX_OUTPUT_BYTES) {
    throw new Error("배경 이미지를 확인하지 못했습니다. 다시 올려 주세요.");
  }
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(image);
    try {
      if (bitmap.width !== BACKGROUND_ASSET_WIDTH || bitmap.height !== BACKGROUND_ASSET_HEIGHT) {
        throw new Error("배경 이미지 크기를 확인하지 못했습니다.");
      }
    } finally { bitmap.close(); }
  } else {
    const objectUrl = URL.createObjectURL(image);
    try {
      const preview = document.createElement("img");
      preview.src = objectUrl;
      await preview.decode();
      if (preview.naturalWidth !== BACKGROUND_ASSET_WIDTH || preview.naturalHeight !== BACKGROUND_ASSET_HEIGHT) {
        throw new Error("배경 이미지 크기를 확인하지 못했습니다.");
      }
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  signal?.throwIfAborted();
}

export function notifyBackgroundAssetsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BACKGROUND_ASSETS_CHANGED));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(BACKGROUND_ASSETS_CHANGED);
      channel.postMessage("changed");
      channel.close();
    } else {
      window.localStorage.setItem(BACKGROUND_ASSETS_CHANGED, String(Date.now()));
    }
  } catch { /* List refresh on focus still works with browser storage disabled. */ }
}

export function subscribeBackgroundAssetsChanged(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let channel: BroadcastChannel | undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === BACKGROUND_ASSETS_CHANGED) onChange();
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(BACKGROUND_ASSETS_CHANGED);
      channel.addEventListener("message", onChange);
    }
  } catch { /* Ignore unavailable cross-tab messaging, not upload failures. */ }
  window.addEventListener(BACKGROUND_ASSETS_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.close();
    window.removeEventListener(BACKGROUND_ASSETS_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
