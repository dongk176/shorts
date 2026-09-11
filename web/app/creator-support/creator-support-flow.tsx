"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SocialLoginButtons } from "@/components/social-login-buttons";
import { creatorKstDate, type CreatorConsentKey, type CreatorPlatform } from "@/lib/creator-support";
import { CREATOR_APPLICATION_TERMS_VERSION, CREATOR_APPLICATION_MINUTES, CREATOR_APPLICATION_LIMIT,
  creatorApplicationTerms, normalizeApplicationChannels, normalizeApplicationPhone, type CreatorApplication } from "@/lib/creator-application";
import type { CreatorApplicationMe } from "@/lib/creator-application-server";
import styles from "./creator-support.module.css";
import { CreatorSupportIntro } from "./creator-support-intro";
import { CreatorChannelLinks, creatorPlatforms } from "./creator-channel-links";

const emptyConsents = { collection: false, disclosure: false, license: false };
class FlowError extends Error { constructor(message: string, public code: string) { super(message); } }
async function api<T>(body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/creator-support/application", {
    credentials: "same-origin", cache: "no-store", signal: signal || AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new FlowError(result.detail || "잠시 후 다시 시도해 주세요.", result.code || `HTTP_${response.status}`);
  return result as T;
}
export function CreatorSupportFlow({ startAtAccount = false, initialAuthError = "" }: { startAtAccount?: boolean; initialAuthError?: string }) {
  const [me, setMe] = useState<CreatorApplicationMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(startAtAccount ? 1 : 0);
  const [ownsChannel, setOwnsChannel] = useState(false);
  const [consents, setConsents] = useState(emptyConsents);
  const [detail, setDetail] = useState<CreatorConsentKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState({ message: initialAuthError, revision: 0 });
  const setError = useCallback((message: string) => setErrorState(current => ({ message, revision: current.revision + 1 })), []);
  const [channelLinks, setChannelLinks] = useState<Record<CreatorPlatform, string>>({ youtube: "", instagram: "" });
  const [phoneNumber, setPhoneNumber] = useState("");
  const accountRef = useRef<string | null>(null);
  const generation = useRef(0);
  const requestId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const accountRequest = useRef(0);
  const surface = useRef<HTMLElement>(null);
  const isIntro = step === 0;
  const monthlyMinutes = CREATOR_APPLICATION_MINUTES;
  const application = me?.application;
  const primaryClassName = `${styles.primary} easycut-private-entry`;
  useEffect(() => {
    if (!error.message) return;
    const timer = window.setTimeout(() => setErrorState(current => current === error ? { ...current, message: "" } : current), 2000);
    return () => window.clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = surface.current;
    if (!viewport || !element) return;
    const resize = () => {
      if (viewport.scale === 1) element.style.setProperty("--creator-viewport-height", `${viewport.height}px`);
      else element.style.removeProperty("--creator-viewport-height");
    };
    resize(); viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, [isIntro]);
  const acceptAccount = useCallback((next: CreatorApplicationMe) => {
    if (accountRef.current !== next.account.key) {
      generation.current += 1; requestId.current = null;
      setOwnsChannel(false); setConsents(emptyConsents); setDetail(null); setStep(1);
      setChannelLinks({ youtube: "", instagram: "" }); setPhoneNumber("");
      accountRef.current = next.account.key;
    }
    setMe(next);
  }, []);
  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof FlowError && ["AUTH_REQUIRED", "HTTP_401", "CREATOR_ACCOUNT_UNAVAILABLE", "ACCOUNT_CHANGED"].includes(cause.code)) {
      generation.current += 1; accountRef.current = null; requestId.current = null;
      setMe(null); setStep(1); setDetail(null); setConsents(emptyConsents); setOwnsChannel(false);
      setChannelLinks({ youtube: "", instagram: "" }); setPhoneNumber("");
    }
    setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "연결이 지연되고 있어요. 입력 내용은 유지됩니다. 다시 시도해 주세요.");
  }, [setError]);
  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++accountRequest.current;
    try {
      const next = await api<CreatorApplicationMe>(undefined, signal);
      if (sequence === accountRequest.current && !signal?.aborted) acceptAccount(next);
    } catch (cause) {
      if (signal?.aborted || sequence !== accountRequest.current) return;
      if (cause instanceof FlowError && ["AUTH_REQUIRED", "HTTP_401"].includes(cause.code)) {
        if (accountRef.current) handleError(cause);
      } else handleError(cause);
    } finally { if (sequence === accountRequest.current && !signal?.aborted) setLoading(false); }
  }, [acceptAccount, handleError]);
  useEffect(() => {
    if (isIntro) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { controller.abort(); setLoading(false); setError("계정 확인이 지연되고 있어요. 다시 시도해 주세요."); }, 20000);
    void loadAccount(controller.signal).finally(() => window.clearTimeout(timer));
    const onFocus = () => { if (document.visibilityState === "visible") void loadAccount(); };
    window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onFocus);
    return () => { accountRequest.current += 1; controller.abort(); clearTimeout(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [isIntro, loadAccount, setError]);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); }, [step, detail]);
  async function next() {
    if (!me || busy) return;
    setError("");
    if (step === 1) { setStep(me.status || me.application ? 4 : 2); return; }
    setBusy(true);
    const expectedAccount = me.account.key;
    try {
      const channels = normalizeApplicationChannels(channelLinks);
      const phone = normalizeApplicationPhone(phoneNumber);
      if (!ownsChannel) throw new Error("등록한 채널의 운영 또는 이용허락 권한을 확인해 주세요.");
      if (step === 2) {
        setChannelLinks({ youtube: channels.find(c => c.platform === "youtube")?.channelUrl || "", instagram: channels.find(c => c.platform === "instagram")?.channelUrl || "" });
        setPhoneNumber(phone); setStep(3); return;
      }
      const confirmed = await api<CreatorApplicationMe>();
      if (confirmed.account.key !== expectedAccount) { acceptAccount(confirmed); throw new Error("로그인 계정이 바뀌었어요. 계정과 동의를 다시 확인해 주세요."); }
      if (!Object.values(consents).every(Boolean)) throw new Error("참여 동의를 모두 확인해 주세요.");
      if (!requestId.current) requestId.current = crypto.randomUUID();
      const currentGeneration = generation.current;
      const result = await api<{ application: CreatorApplication }>({ channels, phoneNumber: phone,
        accountKey: expectedAccount, requestId: requestId.current, ownsChannel,
        termsVersion: CREATOR_APPLICATION_TERMS_VERSION, consents });
      if (generation.current !== currentGeneration) return;
      setMe({ ...confirmed, application: result.application }); setStep(4);
    } catch (cause) { handleError(cause); } finally { setBusy(false); }
  }
  async function switchAccount() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "x-easycut-client-navigation": "1" } });
      if (!response.ok) throw new Error("로그아웃하지 못했어요. 다시 시도해 주세요.");
      window.location.assign("/creator-support?step=account");
    } catch (cause) { handleError(cause); setBusy(false); }
  }
  function closeDetail() { setDetail(null); requestAnimationFrame(() => detailTrigger.current?.focus()); }
  const terms = creatorApplicationTerms;
  const currentDetail = terms.find((item) => item.key === detail);
  const status = me?.status;
  const current = status?.installments.find((item) => item.state === "available");
  if (isIntro) {
    return <CreatorSupportIntro surfaceRef={surface} headingRef={heading} onApply={() => { setLoading(true); setError(""); setStep(1); }} />;
  }
  return (
    <main ref={surface} className={styles.page} data-i18n-skip lang="ko">
      {error.message && <div className={styles.toastOverlay}>
        <div key={error.revision} className={styles.errorToast} role="alert" aria-atomic="true">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3v1" /></svg>
          <span>{error.message}</span>
        </div>
      </div>}
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.progress} role="progressbar" aria-label="파트너 지원 진행 상황" aria-valuemin={0} aria-valuemax={3} aria-valuenow={Math.min(step, 3)} aria-valuetext={step === 4 ? "신청 완료" : `${step}단계, 총 3단계`}>
            <span style={{ transform: `scaleX(${Math.min(step, 3) / 3})` }} />
          </div>
        </header>
        <div className={styles.content} ref={content}>
          <div className={styles.stepBody} data-step={step} data-detail={Boolean(detail)}>
          {currentDetail ? <>
            <p className={styles.eyebrow}>참여 조건 · {CREATOR_APPLICATION_TERMS_VERSION}</p>
            <h1 ref={heading} tabIndex={-1}>{currentDetail.title}</h1>
            <div className={styles.terms}>{currentDetail.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
            <p className={styles.note}><Link href="/privacy" target="_blank">개인정보 처리방침 ↗</Link> · 아티룸</p>
          </> : step === 1 ? <>
            <h1 ref={heading} tabIndex={-1}>{me ? <>신청할 <span>계정</span>을<br />확인해 주세요</> : <><span>이지컷</span> 계정으로<br />시작해 주세요</>}</h1>
            <p className={styles.description}>기존 이지컷 계정을 그대로 사용할 수 있어요.</p>
            {loading ? <p role="status" className={styles.note}>계정을 확인하고 있어요…</p> : me ? <>
              <div className={styles.account}>
                <div><strong>{me.account.name}</strong><span className={styles.badge}>{me.account.provider} 로그인</span></div>
                <p>{me.account.email || (me.account.provider === "카카오" ? "카카오 연결 계정" : "연결된 이지컷 계정")}</p>
                <dl><div><dt>가입일</dt><dd>{creatorKstDate(me.account.joinedAt)}</dd></div><div><dt>참여 상태</dt><dd>{me.status ? "참여 완료" : "미참여"}</dd></div></dl>
              </div>
              <button className={styles.textButton} disabled={busy} onClick={() => void switchAccount()}>다른 계정으로 로그인</button>
              {!me.enrollmentOpen && !me.status && !me.application && <p className={styles.notice}>지금은 신규 모집을 준비 중이거나 마감했어요.</p>}
            </> : <div className={styles.login}>
              <SocialLoginButtons next="/creator-support?step=account" labels={{ google: "구글로 시작하기", kakao: "카카오로 시작하기" }}  />
              <p className={styles.note}>이지컷에서 사용하던 계정으로 로그인해 주세요.</p>
            </div>}
          </> : step === 2 ? <>
            <h1 ref={heading} tabIndex={-1}>어떤 <span>채널</span>을<br />운영하고 계신가요?</h1>
            <p className={styles.description}>채널은 하나만 등록해도 괜찮아요.</p>
            <CreatorChannelLinks values={channelLinks} disabled={busy} onChange={(platform, value) => {
              setChannelLinks((current) => ({ ...current, [platform]: value })); setError("");
            }} />
            <div className={styles.phoneField}>
              <label className={styles.field}>휴대폰 번호<input type="tel" inputMode="tel" autoComplete="tel-national" required maxLength={13} disabled={busy} value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="010-1234-5678" aria-describedby="phone-help" /></label>
              <p id="phone-help" className={styles.phoneHelp}>선정되신 경우 개별 연락드릴 번호를 입력해 주세요.</p>
            </div>
          </> : step === 3 ? <>
            <h1 ref={heading} tabIndex={-1}><span>지원 내용</span>을<br />확인해 주세요</h1>
            <div className={styles.reviewOffer}>
              <p>선정된 파트너에게 매월</p>
              <div className={styles.reviewAmount}><strong>{monthlyMinutes}<span>분</span></strong><span>× 3개월</span></div>
              <p>함께할 크리에이터 {CREATOR_APPLICATION_LIMIT}명을 선정해요.</p>
            </div>
            <div className={styles.consents}>{terms.map((item) => <div key={item.key} className={styles.consentRow}>
              <label className={styles.check}><input type="checkbox" checked={consents[item.key]} disabled={busy} onChange={(e) => setConsents({ ...consents, [item.key]: e.target.checked })} /><span>[필수] {item.title}</span></label>
              <button className={styles.detailButton} aria-label={`${item.title} 자세히 보기`} onClick={(e) => { detailTrigger.current = e.currentTarget; setDetail(item.key); }}>보기</button>
            </div>)}</div>
          </> : application && !status ? <>
            <div className={styles.successMark} aria-hidden>✓</div>
            <p className={styles.eyebrow}>APPLICATION RECEIVED</p>
            <h1 ref={heading} tabIndex={-1}>{application.state === "pending_review" ? "접수 완료" : "신청 결과"}</h1>
            <p className={styles.description}>{application.state === "pending_review" ? <>선정되신 분께 입력해주신 연락처로<br />개별 연락드릴게요.</> : "이번 신청의 검토가 종료되었습니다."}</p>
            <div className={styles.account}>
              <div><strong>신청한 채널</strong><span className={styles.badge}>{application.state === "pending_review" ? "검토 대기" : "검토 종료"}</span></div>
              <dl className={styles.receivedChannels}>{application.channels.map((channel) => <div key={channel.platform}>
                <dt>{creatorPlatforms.find((item) => item.platform === channel.platform)?.label}</dt><dd>{channel.channelUrl}</dd>
              </div>)}</dl>
              <dl><div><dt>휴대폰 번호</dt><dd>{application.phoneNumber || "보관 종료"}</dd></div><div><dt>접수일</dt><dd>{creatorKstDate(application.submittedAt)}</dd></div></dl>
            </div>
            <div className={styles.summary}><strong>선정 후 매월 {monthlyMinutes}분</strong><p>함께할 크리에이터 {CREATOR_APPLICATION_LIMIT}명을 선정해<br />3개월 동안 쇼츠 제작을 지원합니다.</p></div>
          </> : status ? <>
            <div className={styles.successMark} aria-hidden>✓</div>
            <p className={styles.eyebrow}>CREATOR SUPPORT</p>
            <h1 ref={heading} tabIndex={-1}>크리에이터 지원 현황</h1>
            <div className={styles.benefit}><p>{current ? `이번 ${current.number}회차 사용 가능` : "지원 일정"}</p><strong>{current ? Math.floor(current.remainingSeconds / 60) : 0}<span>분 {current && current.remainingSeconds % 60 ? `${current.remainingSeconds % 60}초` : ""}</span></strong><p>이번 회차 잔여 시간{current && <> · {creatorKstDate(current.expiresAt, true)} 만료</>}</p></div>
            <ol className={styles.schedule}>{status.installments.map((item) => <li key={item.number}><span className={styles.number}>{item.number}</span><div><strong>{Math.floor(item.totalSeconds / 60)}분 · {{ scheduled: "지급 예정", available: "지급 완료", expired: "기간 종료", canceled: "지급 취소" }[item.state]}</strong><p>{creatorKstDate(item.validFrom, true)} 지급<br />{creatorKstDate(item.expiresAt, true)} 만료</p></div></li>)}</ol>
            <p className={styles.note}>{status.terminatedAt ? "홍보가 중단됐어요. 이미 시작한 회차는 기존 만료일까지 사용할 수 있습니다." : `홍보 활용 종료: ${creatorKstDate(status.promotionEndsAt, true)}`}<br />시간은 회차별로 만료되며 이월되지 않습니다.</p>
            <button className={styles.textButton} disabled={busy} onClick={() => { setError(""); void loadAccount(); }}>지원 현황 새로고침</button>
          </> : <p>지원 정보를 다시 확인해 주세요.</p>}
          </div>
        </div>
        <footer className={styles.footer}>
          {step === 2 && !detail && <label className={`${styles.check} ${styles.footerConsent}`}>
            <input type="checkbox" checked={ownsChannel} disabled={busy} onChange={(e) => setOwnsChannel(e.target.checked)} />
            <span>등록한 채널의 운영자이거나 이용허락 권한이 있는 담당자입니다.</span>
          </label>}
          {detail ? <button className={primaryClassName} onClick={closeDetail}>닫고 동의 화면으로</button> : step === 4 ? <Link className={primaryClassName} href="/">이지컷으로 돌아가기 <span aria-hidden>↗</span></Link> : <>
            {step === 1 && <button className={styles.back} disabled={busy} onClick={() => { setError(""); setStep(0); }}>이전</button>}
            {step > 1 && <button className={styles.back} disabled={busy} onClick={() => { setError(""); setStep(step === 3 ? 2 : 1); }}>이전</button>}
            <button className={primaryClassName} onClick={() => void next()} disabled={busy || loading || !me || (me && !me.enrollmentOpen && !me.status && !me.application) || (step === 3 && !Object.values(consents).every(Boolean))}>
              <span>{busy ? "처리 중…" : step === 1 ? application ? "신청 현황 보기" : me?.status ? "지원 현황 보기" : "이 계정으로 계속" : step === 2 ? "다음" : "파트너 지원서 제출하기"}</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16m-7-7 7 7-7 7" /></svg>
            </button>
          </>}
        </footer>
      </div>
    </main>
  );
}
