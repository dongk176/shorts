"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { savedVideoCopy, type SavedVideo } from "@/lib/saved-videos";
import type { PopularVideo } from "@/lib/youtube-popular";

export function useSavedVideos(isAuthenticated: boolean, onRequireLogin: () => void, accountKey?: string) {
  const { locale } = useI18n();
  const copy = savedVideoCopy[locale];
  const [items, setItems] = useState<SavedVideo[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<"added" | "removed" | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const busy = useRef(new Set<string>());
  const revision = useRef(0);
  const mounted = useRef(false);
  const accountEpoch = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!isAuthenticated || busy.current.size) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const version = revision.current;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; request.abort(); }, 15000);
    try {
      const response = await fetch("/api/saved-videos", { cache: "no-store", signal: request.signal });
      if (!response.ok) throw new Error("LOAD_FAILED");
      const body = await response.json() as { items: SavedVideo[] };
      if (mounted.current && version === revision.current && !request.signal.aborted) {
        setItems(body.items); setLoadError(false);
      }
    } catch {
      if (mounted.current && (timedOut || !request.signal.aborted) && version === revision.current) setLoadError(true);
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && (timedOut || !request.signal.aborted)) setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    mounted.current = true;
    accountEpoch.current += 1;
    busy.current.clear(); setPending(new Set());
    setItems([]); setLoading(isAuthenticated); setLoadError(false); setNotice(null); setMutationError(null);
    void reload();
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      mounted.current = false; accountEpoch.current += 1; controller.current?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh); window.clearInterval(interval);
    };
  }, [isAuthenticated, accountKey, reload]);

  const mutate = async (video: PopularVideo | null, saved?: SavedVideo) => {
    if (!isAuthenticated) { onRequireLogin(); return; }
    const key = video?.videoId || saved?.id;
    if (!key || busy.current.has(key) || loading || loadError) return;
    const epoch = accountEpoch.current;
    busy.current.add(key); setPending(new Set(busy.current));
    revision.current += 1; controller.current?.abort();
    setMutationError(null); setNotice(null);
    const mutation = new AbortController();
    const timeout = window.setTimeout(() => mutation.abort(), 20000);
    try {
      const response = await fetch("/api/saved-videos", {
        method: saved ? "DELETE" : "POST", signal: mutation.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved ? { id: saved.id } : { videoId: video!.videoId }),
      });
      const body = await response.json();
      if (response.status === 401) { onRequireLogin(); throw new Error("AUTH_REQUIRED"); }
      if (!response.ok) throw new Error(body.code || "SAVE_FAILED");
      if (!mounted.current || epoch !== accountEpoch.current) return;
      if (saved) setItems(current => current.filter(item => item.id !== saved.id));
      else setItems(current => [{ id: body.id, savedAt: new Date().toISOString(), video }, ...current.filter(item => item.id !== body.id)]);
      setNotice(saved ? "removed" : "added");
    } catch (error) {
      if (mounted.current && epoch === accountEpoch.current) setMutationError(error instanceof Error ? error.message : "SAVE_FAILED");
    } finally {
      window.clearTimeout(timeout);
      if (epoch === accountEpoch.current) {
        busy.current.delete(key);
        if (mounted.current) setPending(new Set(busy.current));
      }
    }
  };
  return {
    items, loading, loadError, reload, pending, mutate,
    error: mutationError ? mutationError === "SAVED_VIDEO_LIMIT" ? copy.limit : mutationError === "VIDEO_UNAVAILABLE" ? copy.unavailableSave : copy.mutationError : null,
    notice: notice ? copy[notice] : null,
  };
}
