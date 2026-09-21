"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { Connection, MetaPlatform, Post } from "@/lib/social-publishing/meta/contracts";
import { metaError, metaText } from "@/lib/social-publishing/meta/i18n";
import { PlatformIcon, UploadIcon } from "./publish-ui";
import { PublishingStatusDialog, publishingText, type PublishingFeedback } from "./publishing-status-dialog";

async function request(platform: MetaPlatform, path: string, body?: unknown, method = "POST") {
  const response = await fetch(`/api/social/${platform}${path}`, { cache: "no-store", ...(body === undefined ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(115_000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.code || "META_UNAVAILABLE"), { status: response.status });
  return data;
}
const display = (platform: MetaPlatform) => platform === "instagram" ? "Instagram" as const : "Threads" as const;
const feedbackFor = (post: Post, locale: string, account?: string): PublishingFeedback => ({ id: post.id, phase: post.status === "initiating" ? "processing" : post.status, title: post.title, account, url: post.url || undefined, detail: post.errorCode ? metaError(post.errorCode, locale) : undefined });

export function MetaPublishingPanel({ platform, shortId, title }: { platform: MetaPlatform; shortId: string; title: string }) {
  const { locale } = useI18n(), t = metaText(locale);
  const [connections, setConnections] = useState<Connection[]>([]), [loaded, setLoaded] = useState(false), [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(""), [busy, setBusy] = useState(false), [managing, setManaging] = useState(false), [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState(""), [cooldown, setCooldown] = useState(0), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void request(platform, `?shortId=${shortId}`).then(data => { if (active) { setConnections(data.connections); setReady(data.oauthReady); setCooldown(data.retryAfterSeconds); } }).catch(error => { if (active) setMessage(metaError(error.message, locale)); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [platform, shortId, revision, locale]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(v => Math.max(0, v-1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  useEffect(() => {
    const t = metaText(locale);
    const url = new URL(window.location.href), outcome = url.searchParams.get(`${platform}Account`);
    if (!outcome) return;
    setMessage(outcome === "connected" ? t("connected") : outcome === "cancelled" ? t("cancelled") : metaError(outcome, locale));
    url.searchParams.delete(`${platform}Account`); window.history.replaceState(window.history.state, "", url);
  }, [platform, locale]); // Locale copy is derived from the current route.
  async function connect() {
    setBusy(true); setMessage("");
    try { const result = await request(platform, "/oauth/start", { shortId, returnPath: window.location.pathname }); window.location.assign(result.authorizationUrl); }
    catch (error) { setMessage(metaError(error instanceof Error ? error.message : "", locale)); setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try { const result = await request(platform, `/connections/${confirm}`, { confirm: true }, "DELETE"); setMessage(t(result.revocation === "revoked" ? "disconnected" : "manual")); setConfirm(""); setSelected(""); setRevision(v => v+1); }
    catch (error) { setMessage(metaError(error instanceof Error ? error.message : "", locale)); } finally { setBusy(false); }
  }
  const active = connections.filter(c => c.status === "active"), current = active.find(c => c.id === selected) || active[0];
  const notice = message && <p className="publish-notice" role="status">{message}</p>;
  if (!loaded) return <p role="status" className="publish-note">{t("loading")}</p>;
  if (managing) return <div data-i18n-skip className="publish-manage"><button type="button" className="publish-text-button" onClick={() => setManaging(false)}>{t("back")}</button>{notice}<div className="publish-channel-card"><div className="publish-card-heading"><span><PlatformIcon name={display(platform)}/>{display(platform)}</span><button type="button" className="publish-outline" disabled={busy || !ready || cooldown > 0} onClick={() => void connect()}>{cooldown ? `${cooldown}s` : t("connect")}</button></div><ul className="publish-channel-list">{connections.map(c => <li key={c.id}><span className="publish-channel-name"><strong data-i18n-content>{c.nickname}</strong><small>@{c.username}</small></span><button type="button" className="publish-text-button" disabled={busy} onClick={() => setConfirm(c.id)}>{t("disconnect")}</button></li>)}</ul>{confirm && <div className="publish-notice" role="group" aria-label={t("disconnect")}><p>{t("disconnectHelp")}</p><button type="button" className="publish-outline" disabled={busy} onClick={() => setConfirm("")}>{t("cancel")}</button>{" "}<button type="button" className="publish-primary" disabled={busy} onClick={() => void disconnect()}>{t("disconnect")}</button></div>}</div></div>;
  if (!current) return <div data-i18n-skip>{notice}<div className="publish-connect-layout"><div className="publish-empty"><PlatformIcon name={display(platform)}/><h3>{display(platform)} · {t("connect")}</h3><p>{t("intro")}</p><button type="button" className="publish-primary" disabled={busy || !ready || cooldown > 0} onClick={() => void connect()}>{cooldown ? `${cooldown}s` : t("connect")}</button>{!ready && <p>{t("setup")}</p>}{connections.length > 0 && <button type="button" className="publish-text-button" onClick={() => setManaging(true)}>{t("manage")}</button>}</div><aside className="publish-preview"><video src={`/api/social/${platform}/preview/${shortId}`} controls playsInline preload="metadata"/><strong data-i18n-content>{title}</strong></aside></div></div>;
  return <div data-i18n-skip>{notice}<MetaCompose key={current.id} platform={platform} shortId={shortId} title={title} connection={current} connections={active} onSelect={setSelected} onManage={() => setManaging(true)}/></div>;
}

function MetaCompose({ platform, shortId, title: initialTitle, connection, connections, onSelect, onManage }: { platform: MetaPlatform; shortId: string; title: string; connection: Connection; connections: Connection[]; onSelect: (id: string) => void; onManage: () => void }) {
  const { locale } = useI18n(), t = metaText(locale), id = useId(), maxCaption = platform === "threads" ? 500 : 2200;
  const [title, setTitle] = useState(initialTitle.slice(0, maxCaption)), [rights, setRights] = useState(false), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [posts, setPosts] = useState<Post[]>([]);
  const [feedback, setFeedback] = useState<PublishingFeedback | null>(null), [statusOpen, setStatusOpen] = useState(false), [revision, setRevision] = useState(0);
  const submitting = useRef(false);
  const sync = useCallback(async (check = true) => {
    const data = await request(platform, `/posts?shortId=${shortId}`), next: Post[] = [];
    for (const post of (data.posts as Post[]).filter(post => post.connectionId === connection.id)) {
      next.push(check && ["processing", "unknown"].includes(post.status) ? (await request(platform, `/posts/${post.id}/check`, {})).post : post);
    }
    return next;
  }, [platform, shortId, connection.id]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const until = Date.now()+5*60_000;
    async function poll() {
      try {
        const next = await sync(); if (!active) return;
        setPosts(next);
        setFeedback(current => { const post = next.find(p => p.id === current?.id); return post ? feedbackFor(post, locale, current?.account) : current; });
        if (Date.now() < until && next.some(p => ["initiating", "processing"].includes(p.status))) timer = setTimeout(() => void poll(), 10_000);
        else if (Date.now() >= until) setFeedback(current => current?.phase === "processing" ? { ...current, phase: "unknown" } : current);
      } catch { if (active) setFeedback(current => current && ["sending", "processing"].includes(current.phase) ? { ...current, phase: "unknown" } : current); }
    }
    if (!busy) void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [sync, busy, revision, locale]);
  async function submit() {
    if (submitting.current || !rights || !consent) return;
    submitting.current = true; setBusy(true); setStatusOpen(true); setFeedback({ phase: "sending", title, account: `@${connection.username}` });
    try { const result = await request(platform, "/posts", { shortId, connectionId: connection.id, title, rightsConfirmed: rights, publishConfirmed: consent }); setFeedback(feedbackFor(result.post, locale, `@${connection.username}`)); }
    catch (error) { const status = (error as { status?: number }).status; setFeedback({ phase: status && status < 500 ? "failed" : "unknown", title, account: `@${connection.username}`, detail: metaError(error instanceof Error ? error.message : "", locale) }); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function check() {
    if (checking) return; setChecking(true);
    try { const next = await sync(); setPosts(next); const post = next.find(p => p.id === feedback?.id) || next[0]; if (post) setFeedback(feedbackFor(post, locale, feedback?.account)); setRevision(v => v+1); }
    catch (error) { setFeedback(current => current ? { ...current, phase: "unknown", detail: metaError(error instanceof Error ? error.message : "", locale) } : current); } finally { setChecking(false); }
  }
  const visibility = t(platform === "instagram" ? "instagramVisibility" : "threadsVisibility");
  const result = feedback && feedback.phase !== "failed";
  return <>
    <div className="publish-compose"><form id={id} className="publish-fields" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="publish-field"><div className="publish-label-row"><label htmlFor={`${id}-account`}>{t("channel")}</label><button type="button" disabled={busy} className="publish-text-button" onClick={onManage}>{t("manage")}</button></div><div className="publish-channel-select"><PlatformIcon name={display(platform)}/><select id={`${id}-account`} disabled={busy} value={connection.id} onChange={event => onSelect(event.target.value)}>{connections.map(c => <option key={c.id} value={c.id}>@{c.username} · {c.nickname}</option>)}</select></div></div>
      <div className="publish-field"><label htmlFor={`${id}-caption`}>{t("caption")}</label><textarea id={`${id}-caption`} value={title} disabled={busy} onChange={event => { setTitle(event.target.value); setConsent(false); }} maxLength={maxCaption} rows={4}/><span className="publish-count">{title.length} / {maxCaption}</span></div>
      <div className="publish-notice"><strong>{t("visibility")}</strong><p>{visibility}</p></div>
      <label className="tiktok-check"><input type="checkbox" disabled={busy} checked={rights} onChange={event => setRights(event.target.checked)}/>{t("rights")}</label>
      <label className="tiktok-check"><input type="checkbox" disabled={busy} checked={consent} onChange={event => setConsent(event.target.checked)}/>{t("consent")}</label>
      <p className="publish-note">{t("keepOpen")}</p>
    </form><aside className="publish-preview"><video controls playsInline preload="metadata" src={`/api/social/${platform}/preview/${shortId}`}/><strong data-i18n-content>{title}</strong><span><PlatformIcon name={display(platform)}/>@{connection.username}</span></aside></div>
    {posts.length > 0 && <div className="publish-history"><h3>{t("history")}</h3><ul>{posts.map(post => <li key={post.id}><span className={`publish-result-dot ${post.status === "complete" ? "is-complete" : ""}`}/><div><strong data-i18n-content>{post.title}</strong><small>{t(post.status)}</small></div><button type="button" className="publish-outline" onClick={() => { setFeedback(feedbackFor(post, locale)); setStatusOpen(true); }}>{publishingText(locale, "result")}</button></li>)}</ul></div>}
    <footer className="publish-dialog-footer"><p>{display(platform)} · {t("visibility")}</p><button form={result ? undefined : id} type={result ? "button" : "submit"} className="publish-primary" disabled={busy || !result && (!rights || !consent)} onClick={result ? () => setStatusOpen(true) : undefined}><UploadIcon/>{result ? publishingText(locale, "result") : t("upload")}</button></footer>
    {statusOpen && feedback && <PublishingStatusDialog feedback={feedback} platform={display(platform)} account={feedback.account || ""} privacy={t("visibility")} checking={checking} onCheck={() => void check()} onClose={() => setStatusOpen(false)}/>}
  </>;
}
