"use client";

import Link from "next/link";
import { usePathname } from "@/lib/i18n/navigation";
import { useUsageState } from "./usage-provider";
import { useWelcomeOverlayStage, useRequestRankingEntry } from "./welcome-overlay-queue";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { FeatureGuideOverlay, type FeatureGuideStep } from "./feature-guide-overlay";
import styles from "./ranking-onboarding-preview.module.css";

const PREFIX = "easycut:ranking-beta:v1:";
type Stage = "launch" | "beta" | "tour" | "idle";
function seen(key: string) { try { return localStorage.getItem(PREFIX + key) === "1"; } catch { return false; } }
function mark(key: string) { try { localStorage.setItem(PREFIX + key, "1"); } catch { /* The current visit still works. */ } }

function guideSteps(mobile: boolean): FeatureGuideStep[] {
  return [
    { id: "title", eyebrow: "랭킹 쇼츠 시작하기", title: "어떤 랭킹을 만들까요?", description: "제목을 두 줄로 적어 주세요. 디자인 설정에서 제목의 색상과 폰트를 바꿀 수 있어요.", targetSelector: ".ranking-title-fields", placement: "below", scrollBlock: "center" },
    { id: "order", eyebrow: "순위와 분위기", title: "몇 위까지 만들지 정해 주세요", description: "순위 개수와 재생 순서를 정하고, 필요하면 효과음과 배경음악도 추가하세요. 빈 순위는 건너뛰어요.", targetSelector: ".ranking-guide-controls", placement: "below", scrollBlock: "center" },
    { id: "source", eyebrow: "순위마다 영상 넣기", title: "링크나 파일로 장면을 추가해요", description: mobile ? "원하는 순위를 누른 뒤 장면 선택을 열어 주세요. 아래에서 열리는 창에 링크나 파일을 넣거나, 실시간 인기에서 영상을 찾을 수 있어요." : "순위마다 링크를 붙여 넣거나 파일을 넣어 주세요. 실시간 인기에서 찾기로 장면을 고를 수도 있어요.", targetSelector: mobile ? ".ranking-scene-summary" : ".ranking-source-fields", placement: "above", scrollBlock: "center" },
    { id: "trim", eyebrow: "핵심 장면만 고르기", title: "양끝 손잡이로 구간을 줄여요", description: mobile ? "장면 선택 창의 타임라인에서 시작과 끝을 드래그하세요. 순위당 최대 60초까지 고를 수 있고, 다음 순위 고르기로 이어갈 수 있어요." : "타임라인 양끝을 드래그해 사용할 부분만 골라 주세요. 순위당 최대 60초예요. 화면 조정에서는 위아래를 자르거나 영상 위치를 옮길 수 있어요.", targetSelector: mobile ? ".ranking-scene-summary" : (typeof document !== "undefined" && document.querySelector(".ranking-trim") ? ".ranking-trim" : ".ranking-scene-dialog"), placement: "above", scrollBlock: "center" },
    { id: "preview", eyebrow: "완성 모습 확인", title: "제목과 장면을 함께 확인해요", description: "미리보기에서 제목·순위·화면 배치를 확인하세요. 유튜브는 제작 전까지 플레이어로 보여주고, 영상 만들기를 누르면 다운로드해요.", targetSelector: ".ranking-preview-column", placement: mobile ? "center" : "left", scrollBlock: "center" },
    { id: "create", eyebrow: "이제 하나의 영상으로", title: "준비됐다면 영상 만들기", description: "모든 순위를 채우지 않아도 만들 수 있어요. 전체 길이는 최대 180초예요. 제작 요청을 보내면 아래 프로젝트에서 진행 상황을 확인할 수 있어요.", targetSelector: ".ranking-export-button", placement: "above", scrollBlock: "center" },
    { id: "projects", eyebrow: "완성본은 여기에", title: "프로젝트에서 이어서 확인하세요", description: "제작 상태를 확인하고, 완성된 영상을 재생하거나 다운로드할 수 있어요. 사용법은 제목 옆에서 언제든 다시 볼 수 있어요.", targetSelector: "#ranking-workspace-projects", placement: "above", scrollBlock: "center" },
  ];
}

export function RankingOnboarding({ mode, ownerId }: { mode: "home" | "studio"; ownerId?: string }) {
  const pathname = usePathname();
  const { accountId, authenticated, rankingAvailable } = useUsageState();
  const { active: queueActive, complete } = useWelcomeOverlayStage("ranking-launch");
  const requestRankingEntry = useRequestRankingEntry();
  const identity = ownerId || accountId;
  const remember = (key: string) => mark(`${identity}:${key}`);
  const [stage, setStage] = useState<Stage>("idle");
  const [mobile, setMobile] = useState(false);
  const [tourKey, setTourKey] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const modal = stage === "launch" || stage === "beta";

  useEffect(() => {
    if (mode !== "home" || !queueActive) return;
    // The studio instance owns this stage on its page.
    if (pathname === "/ranking-shorts") return;
    if (pathname !== "/" || !authenticated) { complete(); return; }
    if (!identity || rankingAvailable === undefined) return;
    if (!rankingAvailable || seen(`${identity}:launch`)) { complete(); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    void fetch("/api/ranking-shorts/welcome", {cache:"no-store",signal:controller.signal})
      .then(async response => response.ok ? response.json() : null)
      .then(value => { if (controller.signal.aborted) return; if (value?.eligible) setStage("launch"); else complete(); })
      .catch(() => complete()).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, queueActive, pathname, authenticated, identity, rankingAvailable, complete]);

  useEffect(() => {
    if (mode === "studio" && identity && !seen(`${identity}:beta`)) requestRankingEntry();
  }, [mode, identity, requestRankingEntry]);

  useEffect(() => {
    if (mode !== "studio" || !identity || !queueActive) return;
    if (seen(`${identity}:beta`)) { complete(); return; }
    setStage("beta");
  }, [mode, identity, queueActive, complete]);
  useEffect(() => {
    const media = matchMedia("(max-width: 850px)");
    const resize = () => setMobile(media.matches);
    resize(); media.addEventListener("change", resize);
    const reopen = () => { if(mode === "studio") { setTourKey(value => value + 1); setStage("tour"); } };
    window.addEventListener("ranking-onboarding-guide", reopen);
    return () => { media.removeEventListener("change", resize); window.removeEventListener("ranking-onboarding-guide", reopen); };
  }, [mode]);

  useEffect(() => {
    if (!modal) return;
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.querySelectorAll("video,audio").forEach(media => { if (media instanceof HTMLMediaElement) media.pause(); });
    element?.showModal();
    element?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    const movie = element?.querySelector("video");
    if (movie) void movie.play().catch(() => {});
    return () => { movie?.pause(); element?.close(); document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, [modal, stage]);

  function dismiss() {
    remember(stage === "launch" ? "launch" : "beta");
    complete();
    setStage("idle");
  }
  function startTour() {
    remember("beta");
    complete();
    setTourKey(value => value + 1);
    setStage("tour");
  }
  return <>
    {modal && createPortal(<dialog ref={dialog} tabIndex={-1} className={styles.dialog} aria-labelledby="ranking-welcome-title" onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => { if (event.target !== event.currentTarget) return; const r=event.currentTarget.getBoundingClientRect(); if(event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dismiss(); }}>
      <button type="button" className={styles.close} aria-label="안내 닫기" onClick={dismiss}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
      {stage === "launch" ? <div className={styles.launch}>
        <div className={styles.copy}>
          <h2 id="ranking-welcome-title">랭킹 쇼츠가 출시됐어요!</h2>
          <p>여러 영상에서 고른 장면을 <br />하나의 랭킹 쇼츠로 만들어 보세요.</p>
          <div className={styles.chips}><span>장면 선택</span><span>순위 편집</span><span>효과음</span></div>
          <p className={styles.betaNote}>베타 버전으로 먼저 만나보세요.</p>
          <button type="button" className={styles.later} onClick={dismiss}>나중에 볼게요</button>
          <Link href="/ranking-shorts" className={styles.primary} onClick={() => { remember("launch"); complete(); setStage("idle"); }}>랭킹 쇼츠 시작하기 <span aria-hidden="true">→</span></Link>
        </div>
        <div className={styles.movie}><video src="/ranking-showroom-20/dogs.mp4" poster="/ranking-showroom-20/dogs.jpg" muted playsInline loop aria-label="랭킹 쇼츠 예시" /></div>
      </div> : <div className={styles.beta}>
        <h2 id="ranking-welcome-title">랭킹 쇼츠 베타</h2>
        <p className={styles.intro}>현재 베타 버전으로 제공하고 있어요.</p>
        <button type="button" className={styles.primary} onClick={startTour}>시작하기 <span aria-hidden="true">→</span></button>
      </div>}
    </dialog>, document.body)}
    {stage === "tour" && <FeatureGuideOverlay key={tourKey} enabled steps={guideSteps(mobile)} closeAriaLabel="랭킹 쇼츠 사용법 닫기" tone="coral" smoothTransitions lastStepBack lastStepPrimaryLabel="직접 만들어 보기" onClose={() => { remember("tour"); setStage("idle"); }} onLastStepPrimaryAction={() => document.querySelector(".ranking-heading")?.scrollIntoView({ behavior: "smooth", block: "start" })} />}
  </>;
}
