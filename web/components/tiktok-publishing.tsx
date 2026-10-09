"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { emptyTikTokIntent, validateTikTokIntent } from "@/lib/social-publishing/review-contract";
import type { Connection, Creator, Post } from "@/lib/social-publishing/tiktok/contracts";
import { tiktokError, tiktokText, type TikTokTextKey } from "@/lib/social-publishing/tiktok/i18n";
import { safeTikTokErrorCode, safeTikTokRequestId } from "@/lib/social-publishing/tiktok/errors";
import { PlatformIcon, UploadIcon } from "./publish-ui";
import { PublishingStatusDialog, publishingText, type PublishingFeedback } from "./publishing-status-dialog";

const base = "/api/social/tiktok";
export async function tiktokRequest(url: string, body?: unknown, method = "POST") {
  let response: Response;
  try {
    response = await fetch(base+url, { ...(body === undefined ? { cache: "no-store" as const } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
  } catch { throw new Error("TIKTOK_NETWORK_ERROR"); }
  let data;
  try { data = await response.json(); } catch { throw new Error("TIKTOK_INVALID_RESPONSE"); }
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? "TIKTOK_SIGN_IN" : safeTikTokErrorCode(data?.code)), { status: response.status, requestId: safeTikTokRequestId(data?.requestId) });
  return data;
}
function errorReference(error: unknown) {
  return safeTikTokRequestId(error && typeof error === "object" && "requestId" in error ? error.requestId : undefined);
}

type Settings = { creator: Creator; durationSeconds: number; auditApproved: boolean; mediaReady: boolean };
type TikTokFeedback = PublishingFeedback & { privacy?: string };
function postFeedback(post: Post, locale: string, account?: string): TikTokFeedback {
  return { id: post.id, privacy: post.privacy, phase: post.status === "initiating" ? "processing" : post.status, title: post.title, account, detail: post.errorCode ? tiktokError(post.errorCode, locale) : undefined };
}

export function TikTokPublishingPanel({ shortId, title = "", onCount }: { shortId?: string; title?: string; onCount?: (count: number) => void }) {
  const { locale } = useI18n(), t = tiktokText(locale);
  const [connections, setConnections] = useState<Connection[]>([]), [oauthReady, setOauthReady] = useState(false);
  const [loaded, setLoaded] = useState(false), [selected, setSelected] = useState(""), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [confirm, setConfirm] = useState<string | null>(null), [managing, setManaging] = useState(false);
  const [refresh, setRefresh] = useState(0), [cooldown, setCooldown] = useState(0);
  const [requestId, setRequestId] = useState<string>(), [connectionFailed, setConnectionFailed] = useState(false), [cleanupRequired, setCleanupRequired] = useState(false);
  const load = useCallback(async () => {
    const data = await tiktokRequest(shortId ? `?shortId=${encodeURIComponent(shortId)}` : "");
    setConnections(data.connections); setOauthReady(data.oauthReady); setCooldown(data.retryAfterSeconds || 0); setLoaded(true);
    onCount?.(data.connections.filter((c: Connection) => c.status === "active").length);
  }, [shortId, onCount]);
  useEffect(() => { let active = true; void load().catch(error => { if (active) { setMessage(safeTikTokErrorCode(error.message)); setRequestId(errorReference(error)); setLoaded(true); } }); return () => { active = false; }; }, [load, refresh]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(value => Math.max(0, value-1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  useEffect(() => {
    const url = new URL(window.location.href), outcome = url.searchParams.get("tiktokAccount");
    if (!outcome) return;
    const failed = outcome !== "connected" && outcome !== "cancelled";
    setConnectionFailed(failed); setCleanupRequired(outcome === "revoke_required");
    setMessage(failed ? safeTikTokErrorCode(url.searchParams.get("tiktokError")) : outcome === "connected" ? "connectedNotice" : "cancelled");
    setRequestId(safeTikTokRequestId(url.searchParams.get("tiktokRequest")));
    for (const key of ["tiktokAccount", "tiktokError", "tiktokRequest"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  async function connect() {
    setBusy(true); setMessage(""); setRequestId(undefined); setConnectionFailed(false); setCleanupRequired(false);
    try {
      const data = await tiktokRequest("/oauth/start", { returnPath: window.location.pathname, ...(shortId ? { shortId } : {}) });
      window.location.assign(data.authorizationUrl);
    } catch (error) { setMessage(safeTikTokErrorCode(error instanceof Error ? error.message : undefined)); setRequestId(errorReference(error)); setConnectionFailed(true); setBusy(false); }
  }
  async function disconnect(id: string) {
    setBusy(true); setMessage(""); setRequestId(undefined); setConnectionFailed(false); setCleanupRequired(false);
    try {
      const result = await tiktokRequest(`/connections/${id}`, { confirm: true }, "DELETE");
      setConfirm(null); setSelected(""); setManaging(false);
      setMessage(result.revocation === "revoked" ? "disconnected" : "revokeManual"); setRefresh(value => value+1);
    } catch (error) { setMessage(safeTikTokErrorCode(error instanceof Error ? error.message : undefined)); setRequestId(errorReference(error)); } finally { setBusy(false); }
  }
  const active = connections.filter(c => c.status === "active"), current = active.find(c => c.id === selected) || active[0];
  const isFailure = message.startsWith("TIKTOK_");
  const notice = message && <div role={isFailure ? "alert" : "status"} className={`publish-notice${isFailure ? " publish-error-notice" : ""}`}>
    {isFailure && <strong>{t(connectionFailed ? "connectionFailed" : "requestFailed")}</strong>}
    <p>{isFailure ? tiktokError(message, locale) : t(message as TikTokTextKey)}</p>
    {cleanupRequired && <p>{t("oauthCleanup")}</p>}
    {isFailure && requestId && <small>{t("supportReference")} <span data-i18n-content>{requestId}</span></small>}
  </div>;
  const card = <div className="publish-channel-card">
    <div className="publish-card-heading"><span><PlatformIcon name="TikTok"/>TikTok</span><button type="button" className="publish-outline" disabled={!oauthReady || busy || cooldown > 0} onClick={() => void connect()}>{cooldown ? `${cooldown}s` : `＋ ${t("connect")}`}</button></div>
    {!loaded ? <p className="publish-muted">{t("loading")}</p> : !oauthReady ? <p className="publish-note">{t("setup")}</p> : !connections.length ? <p className="publish-muted">{t("notConnected")}</p> : null}
    {connections.length > 0 && <ul className="publish-channel-list">{connections.map(c => <li key={c.id}><span className="publish-avatar">{c.nickname.slice(0, 1)}</span><span className="publish-channel-name"><strong data-i18n-content>{c.nickname}</strong><small>{c.status === "active" ? t("connected") : t("reconnectRequired")}</small></span><button type="button" className="publish-text-button" disabled={busy || cooldown > 0} onClick={() => void connect()}>{t("reconnect")}</button><button type="button" className="publish-text-button" disabled={busy} onClick={() => setConfirm(c.id)}>{t("disconnect")}</button></li>)}</ul>}
    {confirm && <div className="publish-notice" role="group" aria-label={t("disconnectTitle")}><strong>{t("disconnectTitle")}</strong><p>{t("disconnectHelp")}</p><button type="button" className="publish-outline" disabled={busy} onClick={() => setConfirm(null)}>{t("cancel")}</button>{" "}<button type="button" className="publish-primary" disabled={busy} onClick={() => void disconnect(confirm)}>{t("confirmDisconnect")}</button></div>}
  </div>;
  if (!shortId) return <div data-i18n-skip>{notice}{card}</div>;
  if (!loaded) return <p role="status" className="publish-note">{t("loading")}</p>;
  if (managing) return <div data-i18n-skip className="publish-manage"><button type="button" className="publish-text-button" onClick={() => setManaging(false)}>{t("back")}</button>{notice}{card}</div>;
  if (!current) return <div data-i18n-skip>{notice}<div className="publish-connect-layout"><div className="publish-empty"><PlatformIcon name="TikTok"/><h3>{t("connect")}</h3><p>{t("connectIntro")}</p><button type="button" className="publish-primary" disabled={busy || !oauthReady || cooldown > 0} onClick={() => void connect()}>{cooldown ? `${cooldown}s` : t("connect")}</button>{!oauthReady && <p>{t("setup")}</p>}{connections.length > 0 && <button type="button" className="publish-text-button" onClick={() => setManaging(true)}>{t("manage")}</button>}</div><aside className="publish-preview"><video src={`${base}/preview/${shortId}`} controls playsInline preload="metadata"/><strong data-i18n-content>{title}</strong><small>{t("completedVideo")}</small></aside></div></div>;
  return <div data-i18n-skip>{notice}<TikTokCompose key={`${shortId}:${current.id}`} shortId={shortId} title={title} connection={current} connections={active} onSelect={setSelected} onManage={() => setManaging(true)}/></div>;
}

function TikTokCompose({ shortId, title: initialTitle, connection, connections, onSelect, onManage }: { shortId: string; title: string; connection: Connection; connections: Connection[]; onSelect: (id: string) => void; onManage: () => void }) {
  const { locale } = useI18n(), t = tiktokText(locale), id = useId();
  const [title, setTitle] = useState(initialTitle.slice(0, 2200)), [intent, setIntent] = useState(() => emptyTikTokIntent(connection.id)), [aigc, setAigc] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null), [posts, setPosts] = useState<Post[]>([]);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [feedback, setFeedback] = useState<TikTokFeedback | null>(null), [statusOpen, setStatusOpen] = useState(false), [checking, setChecking] = useState(false);
  const submitting = useRef(false);
  const update = (key: keyof typeof intent, value: boolean | string) => setIntent(previous => ({ ...previous, [key]: value }));
  useEffect(() => {
    let active = true; setSettings(null);
    void tiktokRequest("/creator", { shortId, connectionId: connection.id }).then(data => { if (active) setSettings(data); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [shortId, connection.id, refresh]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const pollUntil = Date.now()+5*60_000;
    async function poll() {
      try {
        const data = await tiktokRequest(`/posts?shortId=${encodeURIComponent(shortId)}`);
        const next: Post[] = [];
        let pollFailed = false;
        for (const post of data.posts as Post[]) {
          if (!active) return;
          if (post.status === "processing") {
            try { next.push((await tiktokRequest(`/posts/${post.id}/check`, {})).post); }
            catch (error) { next.push(post); pollFailed = true; if (active) setMessage(error instanceof Error ? error.message : "TIKTOK_UNAVAILABLE"); }
          } else next.push(post);
        }
        if (active) {
          setPosts(next);
          setFeedback(current => {
            const post = next.find(p => p.id === current?.id);
            if (!post) return current;
            const updated = postFeedback(post, locale, current?.account);
            return (pollFailed || Date.now() >= pollUntil) && ["sending", "processing"].includes(updated.phase) ? { ...updated, phase: "unknown" } : updated;
          });
          if (!pollFailed && Date.now() < pollUntil && next.some(p => ["initiating", "processing"].includes(p.status))) timer = setTimeout(() => void poll(), 6000);
        }
      } catch (error) { if (active) { setMessage(error instanceof Error ? error.message : "TIKTOK_UNAVAILABLE"); setFeedback(current => current && ["sending", "processing"].includes(current.phase) ? { ...current, phase: "unknown" } : current); } }
    }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [shortId, busy, refresh, locale]);
  const issues = settings ? validateTikTokIntent(intent, settings.creator, { nowMs: Date.now(), durationSeconds: settings.durationSeconds, auditApproved: settings.auditApproved }) : ["loading"];
  async function submit() {
    if (submitting.current) return;
    if (feedback && feedback.phase !== "failed") { setStatusOpen(true); return; }
    if (issues.length || !settings?.mediaReady) return;
    submitting.current = true; setBusy(true); setMessage(""); setStatusOpen(true); setFeedback({ phase: "sending", title, account: settings.creator.nickname });
    try { const data = await tiktokRequest("/posts", { ...intent, shortId, title, isAigc: aigc }); setPosts(previous => [data.post, ...previous.filter(p => p.id !== data.post.id)]); setFeedback(postFeedback(data.post, locale, settings.creator.nickname)); }
    catch (error) { const status = (error as { status?: number })?.status; setFeedback({ phase: status && status >= 400 && status < 500 ? "failed" : "unknown", title, account: settings.creator.nickname, detail: tiktokError(error instanceof Error ? error.message : "TIKTOK_UNAVAILABLE", locale) }); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function checkFeedback() {
    if (checking) return;
    setChecking(true);
    try {
      if (feedback?.id) { const data = await tiktokRequest(`/posts/${feedback.id}/check`, {}); setFeedback(postFeedback(data.post, locale, feedback.account)); }
      else { const data = await tiktokRequest(`/posts?shortId=${encodeURIComponent(shortId)}`); setPosts(data.posts); }
      setRefresh(value => value + 1);
    } catch (error) { setFeedback(current => current ? { ...current, phase: "unknown", detail: tiktokError(error instanceof Error ? error.message : "TIKTOK_UNAVAILABLE", locale) } : current); }
    finally { setChecking(false); }
  }
  const showingResult = feedback && feedback.phase !== "failed";
  const profileUrl = /^[A-Za-z0-9._]{1,255}$/.test(connection.username) ? `https://www.tiktok.com/@${encodeURIComponent(connection.username)}` : undefined;
  const privacyKeys: TikTokTextKey[] = ["SELF_ONLY", "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"];
  return <>
    <div className="publish-compose">
      <form id={id} className="publish-fields" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="publish-field"><div className="publish-label-row"><label htmlFor={`${id}-channel`}>{t("channel")}</label><button type="button" className="publish-text-button" onClick={onManage}>{t("manage")}</button></div><div className="publish-channel-select"><PlatformIcon name="TikTok"/><select id={`${id}-channel`} disabled={busy} value={connection.id} onChange={event => onSelect(event.target.value)}>{connections.map(c => <option key={c.id} value={c.id}>{c.id === settings?.creator.connectionId ? settings.creator.nickname : c.nickname}</option>)}</select></div></div>
        <div className="publish-field"><label htmlFor={`${id}-caption`}>{t("caption")}</label><textarea id={`${id}-caption`} value={title} onChange={event => setTitle(event.target.value)} rows={3} maxLength={2200} disabled={busy}/><span className="publish-count">{title.length} / 2200</span></div>
        {!settings ? <p role="status" className="publish-note">{t("loading")}</p> : <>
          <div className="publish-field"><label htmlFor={`${id}-privacy`}>{t("privacy")} *</label><select required id={`${id}-privacy`} value={intent.privacy || ""} disabled={busy} onChange={event => update("privacy", event.target.value)}><option value="">{t("choose")}</option>{settings.creator.privacyOptions.filter(value => privacyKeys.includes(value as TikTokTextKey)).map(value => <option key={value} value={value} disabled={!settings.auditApproved && value !== "SELF_ONLY" || intent.brandedContent && value === "SELF_ONLY"}>{t(value as TikTokTextKey)}</option>)}</select>{!settings.auditApproved && <p className="publish-note">{t("privateOnly")}</p>}</div>
          <fieldset className="tiktok-options" disabled={busy}><legend>{t("interactions")}</legend>{([ ["allowComments", "comments", settings.creator.commentDisabled], ["allowDuet", "duet", settings.creator.duetDisabled], ["allowStitch", "stitch", settings.creator.stitchDisabled] ] as const).map(([key, label, disabled]) => <label key={key} className={disabled ? "is-disabled" : ""}><input type="checkbox" checked={intent[key]} disabled={disabled} onChange={event => update(key, event.target.checked)}/>{t(label)}</label>)}<p className="publish-note">{t("lockedInteraction")}</p></fieldset>
          <fieldset className="tiktok-options" disabled={busy}><label><input type="checkbox" checked={intent.discloseCommercialContent} onChange={event => setIntent(previous => ({ ...previous, discloseCommercialContent: event.target.checked, yourBrand: false, brandedContent: false, brandedContentPolicyConfirmed: false, musicUsageConfirmed: false, rightsConfirmed: false, sendToTikTokConfirmed: false }))}/>{t("disclosure")}</label><p className="publish-note">{t("disclosureHelp")}</p>{intent.discloseCommercialContent && <><label><input type="checkbox" checked={intent.yourBrand} onChange={event => update("yourBrand", event.target.checked)}/>{t("yourBrand")}</label><label className={intent.privacy === "SELF_ONLY" ? "is-disabled" : ""}><input type="checkbox" checked={intent.brandedContent} disabled={intent.privacy === "SELF_ONLY"} onChange={event => setIntent(previous => ({ ...previous, brandedContent: event.target.checked, brandedContentPolicyConfirmed: false, musicUsageConfirmed: false, rightsConfirmed: false, sendToTikTokConfirmed: false }))}/>{t("branded")}</label><p className="publish-note">{t("brandedPrivate")}</p><p className="publish-note">{intent.brandedContent ? t("paidPartnership") : intent.yourBrand ? t("promotional") : t("disclosureChoose")}</p></>}</fieldset>
          <label className="tiktok-check"><input type="checkbox" checked={aigc} disabled={busy} onChange={event => setAigc(event.target.checked)}/>{t("aigc")}</label>
          <label className="tiktok-check"><input type="checkbox" checked={intent.sendToTikTokConfirmed} disabled={busy} onChange={event => setIntent(previous => ({ ...previous, sendToTikTokConfirmed: event.target.checked, rightsConfirmed: event.target.checked, musicUsageConfirmed: event.target.checked, brandedContentPolicyConfirmed: previous.brandedContent && event.target.checked }))}/>{t("rights")}</label>
          <p className="publish-note">{t("byPosting")} {intent.brandedContent && <><a target="_blank" rel="noreferrer" href="https://www.tiktok.com/legal/page/global/bc-policy/en">{t("policy")}</a> · </>}<a target="_blank" rel="noreferrer" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en">{t("music")}</a></p>
          {issues.includes("unsupported_duration") && <p role="alert" className="publish-notice">{t("tooLong")} ({Math.ceil(settings.durationSeconds)}s / {settings.creator.maxDurationSeconds}s)</p>}
          {!settings.mediaReady && <p className="publish-notice">{t("mediaSetup")}</p>}
        </>}
      </form>
      <aside className="publish-preview"><div className="publish-preview-label">{t("preview")}</div><video controls playsInline preload="metadata" src={`${base}/preview/${shortId}`}/><strong data-i18n-content>{title}</strong><span><PlatformIcon name="TikTok"/>{settings?.creator.nickname || connection.nickname}</span><small>{t("completedVideo")}</small></aside>
    </div>
    {message && <p className="publish-notice publish-error-notice" role="alert">{tiktokError(message, locale)} <button type="button" className="publish-text-button" disabled={busy} onClick={() => { setMessage(""); setRefresh(value => value+1); }}>{t("retry")}</button></p>}
    <p className="publish-note">{t("processNote")}</p>
    {posts.length > 0 && <div className="publish-history"><h3>{t("history")}</h3><ul>{posts.map(post => <li key={post.id}><span className={`publish-result-dot ${post.status === "complete" ? "is-complete" : ""}`}/><div><strong data-i18n-content>{post.title}</strong><small>{t(post.status === "failed" ? "postFailed" : post.status)} · {t(post.privacy as TikTokTextKey)}</small>{post.status === "unknown" && <p>{t("unknownNote")}</p>}{post.errorCode && <p>{tiktokError(post.errorCode, locale)}</p>}</div><button type="button" className="publish-outline" onClick={() => { setFeedback(postFeedback(post, locale)); setStatusOpen(true); }}>{publishingText(locale, "result")}</button></li>)}</ul></div>}
    <footer className="publish-dialog-footer"><p>TikTok · {intent.privacy ? t(intent.privacy as TikTokTextKey) : t("choose")}</p><button form={showingResult ? undefined : id} type={showingResult ? "button" : "submit"} onClick={showingResult ? () => setStatusOpen(true) : undefined} className="publish-primary" disabled={busy || !showingResult && (issues.length > 0 || !settings?.mediaReady)}><UploadIcon/>{showingResult ? publishingText(locale, "result") : t("upload")}</button></footer>
    {statusOpen && feedback && <PublishingStatusDialog feedback={{ ...feedback, url: feedback.account ? profileUrl : undefined }} platform="TikTok" account={feedback.account || ""} privacy={t((feedback.privacy || intent.privacy || "choose") as TikTokTextKey)} checking={checking} onCheck={() => void checkFeedback()} onClose={() => setStatusOpen(false)}/>}
  </>;
}
