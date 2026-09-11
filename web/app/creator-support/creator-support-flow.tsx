"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUsageState } from "@/components/usage-provider";
import {
  CREATOR_SUPPORT_TERMS_VERSION, creatorChannelSchema, creatorKstDate, creatorSupportTerms,
  normalizeCreatorChannel, type CreatorConsentKey, type CreatorPlatform, type CreatorSupportMe,
  type CreatorSupportStatus,
} from "@/lib/creator-support";
import styles from "./creator-support.module.css";

type Draft = { platform: CreatorPlatform; channelUrl: string; channelName: string; assetId: string | null };
const emptyDraft: Draft = { platform: "youtube", channelUrl: "", channelName: "", assetId: null };
const emptyConsents = { collection: false, disclosure: false, license: false };
const draftKey = "easycut.creator-support.draft.v1";
class FlowError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/creator-support/${path}`, {
    credentials: "same-origin", cache: "no-store", signal: signal || AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new FlowError(result.detail || "잠시 후 다시 시도해 주세요.", result.code || `HTTP_${response.status}`);
  return result as T;
}

export function CreatorSupportFlow() {
  const { refreshUsage } = useUsageState();
  const [me, setMe] = useState<CreatorSupportMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [ownsChannel, setOwnsChannel] = useState(false);
  const [consents, setConsents] = useState(emptyConsents);
  const [detail, setDetail] = useState<CreatorConsentKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [channelCheck, setChannelCheck] = useState("");
  const [freshActivation, setFreshActivation] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const accountRef = useRef<string | null>(null);
  const generation = useRef(0);
  const requestId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);
  const accountRequest = useRef(0);
  const surface = useRef<HTMLElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    const element = surface.current;
    if (!viewport || !element) return;
    const resize = () => {
      // Safari's layout viewport may remain tall while its keyboard is open.
      // Preserve pinch zoom; use the visible height for the unzoomed form.
      if (viewport.scale === 1) element.style.setProperty("--creator-viewport-height", `${viewport.height}px`);
      else element.style.removeProperty("--creator-viewport-height");
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, []);

  const acceptAccount = useCallback((next: CreatorSupportMe) => {
    if (accountRef.current !== next.account.key) {
      generation.current += 1;
      setDraft(emptyDraft); setOwnsChannel(false); setConsents(emptyConsents); setDetail(null); setStep(1); setFreshActivation(false);
      requestId.current = null;
      try {
        const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
        if (saved?.accountKey === next.account.key && saved.termsVersion === CREATOR_SUPPORT_TERMS_VERSION && !next.status) {
          const parsed = creatorChannelSchema.safeParse({ platform: saved.platform, channelUrl: saved.channelUrl, channelName: saved.channelName });
          if (parsed.success) setDraft({ ...parsed.data, assetId: typeof saved.assetId === "string" ? saved.assetId : null });
        } else sessionStorage.removeItem(draftKey);
      } catch { /* Storage is optional, including private browsing. */ }
      accountRef.current = next.account.key;
    }
    setMe(next);
  }, []);

  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof FlowError && ["AUTH_REQUIRED", "HTTP_401", "CREATOR_ACCOUNT_UNAVAILABLE", "ACCOUNT_CHANGED"].includes(cause.code)) {
      generation.current += 1;
      accountRef.current = null; setMe(null); setStep(1); setDetail(null); setConsents(emptyConsents); setOwnsChannel(false);
    }
    setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "연결이 지연되고 있어요. 입력 내용은 유지됩니다. 다시 시도해 주세요.");
  }, []);

  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++accountRequest.current;
    try {
      const next = await api<CreatorSupportMe>("me", undefined, signal);
      if (sequence === accountRequest.current && !signal?.aborted) acceptAccount(next);
    }
    catch (cause) {
      if (signal?.aborted || sequence !== accountRequest.current) return;
      if (cause instanceof FlowError && ["AUTH_REQUIRED", "HTTP_401"].includes(cause.code)) {
        if (accountRef.current) handleError(cause);
      } else handleError(cause);
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [acceptAccount, handleError]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); setLoading(false); setError("계정 확인이 지연되고 있어요. 다시 시도해 주세요."); }, 20_000);
    void loadAccount(controller.signal).finally(() => window.clearTimeout(timeout));
    const onFocus = () => { if (document.visibilityState === "visible") void loadAccount(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { controller.abort(); clearTimeout(timeout); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [loadAccount]);
  useEffect(() => {
    if (!me || me.status) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ ...draft, accountKey: me.account.key, termsVersion: CREATOR_SUPPORT_TERMS_VERSION })); }
    catch { /* The form also works without browser storage. */ }
  }, [draft, me]);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step, detail]);
  useEffect(() => {
    if (step !== 2 || !draft.channelUrl.trim() || !me) { setChannelCheck(""); return; }
    const controller = new AbortController();
    setChannelCheck("");
    const timeout = window.setTimeout(() => {
      try { normalizeCreatorChannel(draft.platform, draft.channelUrl); }
      catch (cause) { setChannelCheck(cause instanceof Error ? cause.message : "주소를 확인해 주세요."); return; }
      void api<{ available: boolean }>("channel", { accountKey: me.account.key, platform: draft.platform, channelUrl: draft.channelUrl }, controller.signal)
        .then(() => { if (!controller.signal.aborted) setChannelCheck("등록 가능한 채널 주소예요."); })
        .catch((cause) => {
          if (!controller.signal.aborted) {
            if (cause instanceof FlowError && ["AUTH_REQUIRED", "ACCOUNT_CHANGED"].includes(cause.code)) handleError(cause);
            else setChannelCheck(cause instanceof Error ? cause.message : "다음 버튼을 눌러 다시 확인해 주세요.");
          }
        });
    }, 650);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [draft.platform, draft.channelUrl, step, me, handleError]);

  async function next() {
    if (!me) return;
    setError("");
    if (step === 1) { setStep(me.status ? 4 : 2); return; }
    setBusy(true);
    const expectedAccount = me.account.key;
    try {
      if (step === 2) {
        const parsed = creatorChannelSchema.safeParse({ platform: draft.platform, channelUrl: draft.channelUrl, channelName: draft.channelName });
        if (!parsed.success) throw new Error("채널 주소와 공개할 채널명을 확인해 주세요.");
        if (!ownsChannel) throw new Error("채널 운영 또는 이용허락 권한을 확인해 주세요.");
        const checked = await api<{ channelUrl: string }>("channel", { accountKey: expectedAccount, platform: draft.platform, channelUrl: draft.channelUrl });
        if (accountRef.current !== expectedAccount) return;
        setDraft((current) => ({ ...current, channelUrl: checked.channelUrl })); setStep(3);
      } else {
        const confirmed = await api<CreatorSupportMe>("me");
        if (confirmed.account.key !== expectedAccount) {
          acceptAccount(confirmed); throw new Error("로그인 계정이 바뀌었어요. 계정과 동의를 다시 확인해 주세요.");
        }
        if (!Object.values(consents).every(Boolean)) throw new Error("참여 동의를 모두 확인해 주세요.");
        if (!requestId.current) requestId.current = crypto.randomUUID();
        const currentGeneration = generation.current;
        const result = await api<{ status: CreatorSupportStatus }>("enroll", {
          ...draft, accountKey: expectedAccount, requestId: requestId.current, ownsChannel,
          termsVersion: CREATOR_SUPPORT_TERMS_VERSION, consents,
        });
        if (generation.current !== currentGeneration) return;
        setMe({ ...confirmed, status: result.status }); setFreshActivation(!confirmed.status); setStep(4);
        try { sessionStorage.removeItem(draftKey); } catch { /* Optional storage. */ }
        void refreshUsage();
      }
    } catch (cause) { handleError(cause); }
    finally { setBusy(false); }
  }
  async function switchAccount() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "x-easycut-client-navigation": "1" } });
      if (!response.ok) throw new Error("로그아웃하지 못했어요. 다시 시도해 주세요.");
      try { sessionStorage.removeItem(draftKey); } catch { /* Optional storage. */ }
      window.location.assign("/creator-support");
    } catch (cause) { handleError(cause); setBusy(false); }
  }
  async function upload(file: File | undefined) {
    if (!file || !me) return;
    setBusy(true); setError("");
    const expectedAccount = me.account.key;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("이미지는 2MB 이하로 선택해 주세요.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = reject;
        reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(file);
      });
      const result = await api<{ assetId: string }>("assets", { accountKey: expectedAccount, image: data });
      if (accountRef.current === expectedAccount) setDraft((current) => ({ ...current, assetId: result.assetId }));
    } catch (cause) { handleError(cause); }
    finally { setBusy(false); if (inputFile.current) inputFile.current.value = ""; }
  }
  function closeDetail() {
    setDetail(null);
    requestAnimationFrame(() => detailTrigger.current?.focus());
  }

  const currentDetail = creatorSupportTerms.find((item) => item.key === detail);
  const status = me?.status;
  const current = status?.installments.find((item) => item.state === "available");
  return (
    <main ref={surface} className={styles.page} data-i18n-skip lang="ko">
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}><Image src="/east-cut-logo.png" alt="" width={25} height={25} />easycut<span>크리에이터 지원</span></Link>
          <span className={styles.progress} aria-label={step === 4 ? "신청 완료" : `${step}단계, 총 3단계`}>{step === 4 ? "완료" : `${step}/3`}</span>
        </header>
        <div className={styles.track} aria-hidden><span style={{ width: `${Math.min(step, 3) / 3 * 100}%` }} /></div>
        <div className={styles.content} ref={content}>
          {currentDetail ? <>
            <p className={styles.eyebrow}>참여 조건 · {CREATOR_SUPPORT_TERMS_VERSION}</p>
            <h1 ref={heading} tabIndex={-1}>{currentDetail.title}</h1>
            <div className={styles.terms}>{currentDetail.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
            <p className={styles.note}><Link href="/privacy" target="_blank">개인정보 처리방침 ↗</Link> · 아티룸</p>
          </> : step === 1 ? <>
            <p className={styles.eyebrow}>함께 만드는 다음 콘텐츠</p>
            <h1 ref={heading} tabIndex={-1}>이지컷 파트너<br />크리에이터를 찾습니다</h1>
            <p className={styles.description}>채널 소개·광고 활용에 참여하고,<br />매월 30분씩 3개월간 지원받으세요.</p>
            <div className={styles.benefit}><strong>30<span>분</span> × 3<span>개월</span></strong><p>사용량 지원 3개월 · 홍보 활용 1년</p></div>
            {loading ? <p role="status" className={styles.note}>계정을 확인하고 있어요…</p> : me ? <>
              <div className={styles.account}>
                <div><strong>{me.account.name}</strong><span className={styles.badge}>{me.account.provider} 로그인</span></div>
                <p>{me.account.email || (me.account.provider === "카카오" ? "카카오 연결 계정" : "연결된 이지컷 계정")}</p>
                <dl><div><dt>가입일</dt><dd>{creatorKstDate(me.account.joinedAt)}</dd></div><div><dt>참여 상태</dt><dd>{me.status ? "참여 완료" : "미참여"}</dd></div></dl>
              </div>
              <button className={styles.textButton} disabled={busy} onClick={() => void switchAccount()}>다른 계정으로 로그인</button>
              {!me.enrollmentOpen && !me.status && <p className={styles.notice}>지금은 신규 모집을 준비 중이거나 마감했어요.</p>}
            </> : <div className={styles.login}>
              <button className={styles.google} onClick={() => window.location.assign("/auth/sign-in?provider=google&next=%2Fcreator-support")}><span aria-hidden>G</span>구글로 로그인</button>
              <button className={styles.kakao} onClick={() => window.location.assign("/auth/sign-in?provider=kakao&next=%2Fcreator-support")}><span aria-hidden>●</span>카카오로 로그인</button>
              <p className={styles.note}>이지컷에서 사용하던 계정으로 로그인해 주세요.<br />카카오 이메일이 없어도 참여할 수 있어요.</p>
            </div>}
          </> : step === 2 ? <>
            <p className={styles.eyebrow}>02 · 채널 등록</p>
            <h1 ref={heading} tabIndex={-1}>어떤 채널을<br />운영하고 계신가요?</h1>
            <p className={styles.description}>소개할 대표 채널 하나를 알려주세요.</p>
            <fieldset className={styles.platforms} disabled={busy}><legend className={styles.srOnly}>채널 플랫폼</legend>{(["youtube", "instagram"] as const).map((platform) => <label key={platform} data-selected={draft.platform === platform}>
              <input type="radio" name="platform" value={platform} checked={draft.platform === platform} onChange={() => { setDraft({ ...draft, platform, channelUrl: "" }); setChannelCheck(""); }} />{platform === "youtube" ? "유튜브" : "인스타그램"}
            </label>)}</fieldset>
            <label className={styles.field}>채널 주소<input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" autoComplete="url" spellCheck={false} maxLength={400} disabled={busy} value={draft.channelUrl} onChange={(e) => setDraft({ ...draft, channelUrl: e.target.value })} placeholder={draft.platform === "youtube" ? "youtube.com/@mychannel" : "instagram.com/mychannel"} aria-describedby="channel-check" /></label>
            <p className={styles.validation} id="channel-check" aria-live="polite">{channelCheck || "채널 홈 또는 프로필 주소를 입력해 주세요."}</p>
            <label className={styles.field}>공개할 채널명<input maxLength={60} disabled={busy} value={draft.channelName} onChange={(e) => setDraft({ ...draft, channelName: e.target.value })} placeholder="예: 오늘의 기록" /></label>
            <button className={styles.textButton} onClick={() => setShowImage(!showImage)} aria-expanded={showImage}>＋ 프로필 이미지 {draft.assetId ? "등록됨" : "추가 (선택)"}</button>
            {showImage && <div className={styles.upload}>{draft.assetId && <Image unoptimized width={48} height={48} src={`/api/creator-support/assets/${draft.assetId}`} alt="등록한 프로필 이미지" />}<div><input ref={inputFile} aria-label="프로필 이미지 파일" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} /><p className={styles.note}>JPG·PNG·WEBP, 2MB 이하. 없으면 이름·링크만 소개해요.</p>{draft.assetId && <button className={styles.textButton} disabled={busy} onClick={() => setDraft({ ...draft, assetId: null })}>이미지 사용 안 함</button>}</div></div>}
            <label className={styles.check}><input type="checkbox" checked={ownsChannel} disabled={busy} onChange={(e) => setOwnsChannel(e.target.checked)} /><span>이 채널의 운영자이거나 이용허락 권한이 있는 담당자입니다.</span></label>
            <p className={styles.note}>실제 홍보 전 운영 권한과 소재 권리를 확인해요.</p>
          </> : step === 3 ? <>
            <p className={styles.eyebrow}>03 · 동의 및 활성화</p>
            <h1 ref={heading} tabIndex={-1}>지원 내용을<br />확인해 주세요</h1>
            <div className={styles.summary}><strong>지금 30분 지급</strong><p>이후 매월 30분씩 총 3회<br />회차별 잔여 시간은 이월되지 않습니다.</p><hr /><b>채널 소개·온라인 광고 활용 1년</b><p>활성화일부터 · 별도 소재 사용료 없음</p></div>
            <p className={styles.scope}>등록한 <b>채널명·링크·제공 이미지</b>를 홈페이지·공식 SNS·서비스 소개자료와 인스타그램·페이스북·유튜브 유료 광고에 활용합니다.</p>
            <div className={styles.consents}>{creatorSupportTerms.map((item) => <div key={item.key} className={styles.consentRow}>
              <label className={styles.check}><input type="checkbox" checked={consents[item.key]} disabled={busy} onChange={(e) => setConsents({ ...consents, [item.key]: e.target.checked })} /><span>[필수] {item.title}</span></label>
              <button className={styles.detailButton} aria-label={`${item.title} 자세히 보기`} onClick={(e) => { detailTrigger.current = e.currentTarget; setDetail(item.key); }}>보기</button>
            </div>)}</div>
            <p className={styles.note}>계정 이름·이메일은 공개하지 않아요.<br />영상·썸네일·후기·얼굴·음성의 별도 활용은 추가 허락을 받아요.</p>
          </> : status ? <>
            <div className={styles.successMark} aria-hidden>✓</div>
            <p className={styles.eyebrow}>CREATOR SUPPORT</p>
            <h1 ref={heading} tabIndex={-1}>{freshActivation ? <>3개월 크리에이터 지원이<br />활성화됐어요</> : "크리에이터 지원 현황"}</h1>
            <div className={styles.benefit}><p>{freshActivation ? "이번 회차 30분 지급 완료" : current ? `이번 ${current.number}회차 사용 가능` : "지원 일정"}</p><strong>{current ? Math.floor(current.remainingSeconds / 60) : 0}<span>분 {current && current.remainingSeconds % 60 ? `${current.remainingSeconds % 60}초` : ""}</span></strong><p>이번 회차 잔여 시간{current && <> · {creatorKstDate(current.expiresAt, true)} 만료</>}</p></div>
            <ol className={styles.schedule}>{status.installments.map((item) => <li key={item.number}><span className={styles.number}>{item.number}</span><div><strong>30분 · {{ scheduled: "지급 예정", available: "지급 완료", expired: "기간 종료", canceled: "지급 취소" }[item.state]}</strong><p>{creatorKstDate(item.validFrom, true)} 지급<br />{creatorKstDate(item.expiresAt, true)} 만료</p></div></li>)}</ol>
            <p className={styles.note}>{status.terminatedAt ? "홍보가 중단됐어요. 이미 시작한 회차는 기존 만료일까지 사용할 수 있습니다." : `홍보 활용 종료: ${creatorKstDate(status.promotionEndsAt, true)}`}<br />시간은 회차별로 만료되며 이월되지 않습니다.</p>
            <button className={styles.textButton} disabled={busy} onClick={() => { setError(""); void loadAccount(); }}>지원 현황 새로고침</button>
          </> : <p>지원 정보를 다시 확인해 주세요.</p>}
          {error && <div className={styles.error} role="alert">{error}{!me && !loading && <button className={styles.textButton} onClick={() => { setLoading(true); setError(""); void loadAccount(); }}>계정 다시 확인</button>}</div>}
        </div>
        <footer className={styles.footer}>
          {detail ? <button className={styles.primary} onClick={closeDetail}>닫고 동의 화면으로</button> : step === 4 ? <Link className={styles.primary} href="/">이지컷에서 바로 사용하기 <span aria-hidden>↗</span></Link> : <>
            {step > 1 && <button className={styles.back} disabled={busy} onClick={() => { setError(""); setStep(step === 3 ? 2 : 1); }}>이전</button>}
            <button className={styles.primary} onClick={() => void next()} disabled={busy || loading || !me || (!me.enrollmentOpen && !me.status) || (step === 3 && !Object.values(consents).every(Boolean))}>{busy ? "처리 중…" : step === 1 ? me?.status ? "지원 현황 보기" : "이 계정으로 계속" : step === 2 ? "다음" : "동의하고 3개월 지원 활성화"}</button>
          </>}
          <a className={styles.contact} href="mailto:easycut@easycut.co.kr">문의·철회 요청 · easycut@easycut.co.kr</a>
        </footer>
      </div>
    </main>
  );
}
