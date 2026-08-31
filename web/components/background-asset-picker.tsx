"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BACKGROUND_ASSET_MAX_LISTED,
  type BackgroundAssetList,
  type BackgroundAssetMetadata,
} from "@/lib/background-assets-contract";
import {
  notifyBackgroundAssetsChanged,
  removeBackgroundAssetFromLibrary,
  requestBackgroundAssetList,
  subscribeBackgroundAssetsChanged,
  uploadBackgroundAsset,
  verifyBackgroundAssetSelection,
} from "@/lib/background-assets-client";
import { userFacingErrorMessage } from "@/lib/public-error";

type UploadedBackground = { kind: "uploaded_image"; assetId: string };

export function BackgroundAssetPicker({
  value,
  onSelect,
  onRestore,
  onBusyChange,
  disabled = false,
  canUpload = true,
}: {
  value?: { kind: string; assetId?: string } | null;
  onSelect: (background: UploadedBackground) => void;
  onRestore: () => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  canUpload?: boolean;
}) {
  const [library, setLibrary] = useState<BackgroundAssetList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BackgroundAssetMetadata | null>(null);
  const removalDescriptionId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const listRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;

  const setMutationBusy = useCallback((next: boolean) => {
    setBusy(next);
    busyCallback.current?.(next);
  }, []);

  const refresh = useCallback(async () => {
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    try {
      const next = await requestBackgroundAssetList(request.signal);
      if (!mounted.current || request.signal.aborted) return;
      setLibrary(next);
      setError(null);
    } catch (cause) {
      if (!mounted.current || request.signal.aborted) return;
      setError(userFacingErrorMessage(cause, "내 배경 목록을 불러오지 못했습니다."));
    } finally {
      if (mounted.current && !request.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onRefresh = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const unsubscribe = subscribeBackgroundAssetsChanged(onRefresh);
    window.addEventListener("focus", onRefresh);
    window.addEventListener("pageshow", onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      listRequest.current?.abort();
      mutationRequest.current?.abort();
      busyCallback.current?.(false);
      unsubscribe();
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("pageshow", onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const upload = async (file: File) => {
    if (disabled || !canUpload || mutationRequest.current) return;
    const request = new AbortController();
    mutationRequest.current = request;
    setMutationBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { asset, reused } = await uploadBackgroundAsset(file, request.signal);
      notifyBackgroundAssetsChanged();
      await verifyBackgroundAssetSelection(asset.id, request.signal);
      if (!mounted.current || request.signal.aborted) return;
      onSelect({ kind: "uploaded_image", assetId: asset.id });
      setMessage(reused ? "보관된 배경을 선택했습니다." : "내 배경에 저장하고 선택했습니다. 편집·템플릿에서 다시 사용할 수 있습니다.");
    } catch (cause) {
      if (mounted.current && !request.signal.aborted) {
        setError(userFacingErrorMessage(cause, "이미지를 올리지 못했습니다. 기존 배경은 유지됩니다."));
      }
    } finally {
      mutationRequest.current = null;
      if (mounted.current) setMutationBusy(false);
    }
  };

  const select = async (asset: BackgroundAssetMetadata) => {
    if (disabled || !canUpload || mutationRequest.current) return;
    const request = new AbortController();
    mutationRequest.current = request;
    setMutationBusy(true);
    setError(null);
    setMessage(null);
    try {
      await verifyBackgroundAssetSelection(asset.id, request.signal);
      if (mounted.current && !request.signal.aborted) onSelect({ kind: "uploaded_image", assetId: asset.id });
    } catch (cause) {
      if (mounted.current && !request.signal.aborted) setError(userFacingErrorMessage(cause, "배경을 확인하지 못했습니다. 기존 배경은 유지됩니다."));
    } finally {
      mutationRequest.current = null;
      if (mounted.current) setMutationBusy(false);
    }
  };

  const remove = async (asset: BackgroundAssetMetadata) => {
    if (disabled || mutationRequest.current) return;
    const request = new AbortController();
    mutationRequest.current = request;
    setMutationBusy(true);
    setError(null);
    setMessage(null);
    try {
      await removeBackgroundAssetFromLibrary(asset.id, request.signal);
      if (!mounted.current || request.signal.aborted) return;
      setRemoving(null);
      setMessage("목록에서 제거했습니다. 이미 사용 중인 템플릿·영상의 배경은 유지됩니다.");
      notifyBackgroundAssetsChanged();
    } catch (cause) {
      if (mounted.current && !request.signal.aborted) setError(userFacingErrorMessage(cause, "배경을 목록에서 제거하지 못했습니다."));
    } finally {
      mutationRequest.current = null;
      if (mounted.current) setMutationBusy(false);
    }
  };

  const locked = disabled || busy;
  return <section aria-label="내 배경" aria-busy={busy || loading} className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-neutral-100">내 배경 <span className="ml-1 text-xs font-normal text-neutral-500">{library?.quota.listedCount ?? 0}/{library?.quota.maxListed ?? BACKGROUND_ASSET_MAX_LISTED}</span></h3>
      <button type="button" disabled={locked} onClick={onRestore} className="text-[11px] font-bold text-neutral-400 hover:text-white disabled:opacity-40">기본 배경 복원</button>
    </div>
    {canUpload && <>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="내 배경 이미지 업로드"
        className="hidden"
        disabled={locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <button type="button" disabled={locked} onClick={() => fileInput.current?.click()} className="w-full rounded-xl border border-dashed border-white/25 bg-white/[.03] px-3 py-3 text-xs font-bold text-neutral-100 transition hover:border-[#ff715e] disabled:opacity-40">{busy && !removing ? "이미지 확인·보관 중…" : "+ 배경 이미지 업로드"}</button>
      <p className="text-[11px] leading-5 text-neutral-500">JPG·PNG·정지 WebP · 3MB 이하. 가운데 기준으로 9:16 화면을 채우며, 업로드에 성공한 배경은 계속 보관됩니다.</p>
    </>}
    {loading ? <p className="py-3 text-xs text-neutral-400" role="status">내 배경을 불러오는 중…</p> : null}
    {!loading && library?.assets.length === 0 ? <p className="rounded-lg bg-black/20 px-3 py-4 text-xs text-neutral-500">아직 보관한 배경이 없습니다.</p> : null}
    {(library?.assets.length || 0) > 0 && <div className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto pr-1" aria-label="보관한 배경 목록">
      {library?.assets.map((asset) => {
        const selected = value?.kind === "uploaded_image" && value.assetId === asset.id;
        return <div key={asset.id} className="min-w-0">
          <button type="button" disabled={locked || !canUpload} onClick={() => void select(asset)} title={asset.displayName} aria-label={`${asset.displayName} 배경 선택`} aria-pressed={selected} className={`relative block aspect-[9/16] w-full overflow-hidden rounded-lg border disabled:opacity-50 ${selected ? "border-[#ff715e] ring-2 ring-[#ff715e]/25" : "border-white/10 hover:border-white/35"}`}>
            <Image src={asset.imageUrl} alt="" fill sizes="120px" unoptimized className="object-cover" />
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-black/20 px-1 py-1.5 text-[9px] font-bold text-white">{asset.displayName}</span>
          </button>
          <button type="button" disabled={locked} onClick={() => setRemoving(asset)} aria-label={`${asset.displayName} 목록에서 제거`} className="mt-1 w-full rounded px-1 py-1 text-[10px] text-neutral-500 hover:bg-white/5 hover:text-red-200 disabled:opacity-40">목록에서 제거</button>
        </div>;
      })}
    </div>}
    {removing && <div role="alertdialog" aria-label="내 배경 목록에서 제거" aria-describedby={removalDescriptionId} className="rounded-xl border border-white/15 bg-black/30 p-3">
      <p id={removalDescriptionId} className="text-xs leading-5 text-neutral-300">‘{removing.displayName}’을 목록에서 제거할까요? 이미 사용 중인 템플릿·영상은 유지되며, 파일은 즉시 삭제되지 않습니다.</p>
      <div className="mt-3 flex justify-end gap-2"><button type="button" disabled={locked} onClick={() => setRemoving(null)} className="rounded-lg px-3 py-2 text-xs text-neutral-400">취소</button><button type="button" disabled={locked} onClick={() => void remove(removing)} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-red-200 disabled:opacity-40">{busy ? "제거 중…" : "목록에서 제거"}</button></div>
    </div>}
    {error && <div role="alert" className="text-xs leading-5 text-red-200"><p>{error}</p><button type="button" disabled={locked} onClick={() => void refresh()} className="mt-1 underline">목록 다시 불러오기</button></div>}
    {message && <p role="status" className="text-[11px] leading-5 text-emerald-200">{message}</p>}
    {library && <p className="text-[10px] leading-4 text-neutral-600">보관 용량 {Math.ceil(library.quota.bytesUsed / 1024 / 1024)} / {Math.round(library.quota.maxBytes / 1024 / 1024)}MB · 기존 영상 때문에 보관 중인 파일도 포함됩니다.</p>}
  </section>;
}
