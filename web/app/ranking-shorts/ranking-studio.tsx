"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RankingExamples } from "./ranking-examples";
import { RankingSelect } from "./ranking-select";
import {
  defaultRankingStyle,
  rankingColors,
  rankingDesign,
  rankingPreset,
  type RankingStyle,
} from "@/lib/ranking-templates";
import { RankingAudioSettings } from "./ranking-audio-settings";
import { rankingAudioSequence, transitionSeconds, type RankingSound } from "@/lib/ranking-audio";
import { RankingSequencePreview } from "./ranking-sequence-preview";
import {
  RankingRemotePlayer,
  type RankingRemoteHandle,
} from "./ranking-remote-player";
import { RankingColorField } from "./ranking-color-field";
import { RankingTimeline } from "./ranking-timeline";
import { RankingProgressOverlay } from "./ranking-progress-overlay";
import { RankingOrderEditor } from "./ranking-order-editor";
import { rankingDirectRemote } from "@/lib/ranking-embed";
import { rankingOrderForCount } from "@/lib/ranking-order";
import {
  RANKING_LIMITS,
  rankingRenderSchema,
  rankingTime,
  type RankingSource,
} from "@/lib/ranking-shorts";

type Slot = {
  link: string;
  label: string;
  source: RankingSource | null;
  pendingLink?: boolean;
  start: number;
  end: number;
};
const emptySlots = (): Slot[] =>
  Array.from({ length: RANKING_LIMITS.ranks }, () => ({
    link: "",
    label: "",
    source: null,
    start: 0,
    end: 0,
  }));
type Result = { url: string; duration: number };

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error || "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
    );
  return data;
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));
async function waitForOperation(data: { pollUrl: string }) {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const state = await requestJson(data.pollUrl, { method: "GET" });
    if (state.status === "succeeded") return state.result;
    if (state.status === "failed")
      throw new Error(state.error || "영상 처리를 완료하지 못했습니다.");
    await pause(3000);
  }
  throw new Error(
    "작업 상태 확인이 지연되고 있습니다. 최근 작업에서 확인해 주세요. 완료되면 이메일로 알려드립니다.",
  );
}

export function RankingStudio({
  initialProject = null,
  initialOperation = null,
}: {
  initialProject?: string | null;
  initialOperation?: string | null;
}) {
  const router = useRouter();
  const submission = useRef<{ key: string; requestId: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [sound, setSound] = useState<RankingSound>("lip-bass");
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [music, setMusic] = useState<{id: string; name: string} | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.15);
  const transitionSound = soundEnabled ? sound : null;
  const backgroundMusic = musicEnabled && music ? {sourceId: music.id, volume: musicVolume} : null;
  const [count, setCount] = useState(5);
  const [active, setActive] = useState(0);
  const [slots, setSlots] = useState(emptySlots);
  const [title, setTitle] = useState("놓치면 아쉬운 순간");
  const [style, setStyle] = useState<RankingStyle>(defaultRankingStyle);
  const [subtitle, setSubtitle] = useState("오늘의 랭킹");
  const player = useRef<HTMLVideoElement>(null);
  const remotePlayer = useRef<RankingRemoteHandle>(null);
  const previewFallbacks = useRef(new Set<string>());
  const [current, setCurrent] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [previewPauseSignal, setPreviewPauseSignal] = useState(0);
  const [orderMode, setOrderMode] = useState<"desc" | "asc" | "custom">("desc");
  const [customOrder, setCustomOrder] = useState<number[]>([]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [customDesignOpen, setCustomDesignOpen] = useState(false);
  const [project, setProject] = useState<string | null>(null);
  const projectRef = useRef<string | null>(null);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<
    { id: string; title: string; status: string }[]
  >([]);
  useEffect(() => {
    if (!initialProject) return;
    let alive = true;
    void (async () => {
      try {
        setBusy("작업을 불러오고 있습니다…");
        const data = await requestJson(
          `/api/ranking-shorts/${initialProject}${initialOperation ? `?operation=${encodeURIComponent(initialOperation)}` : ""}`,
          { method: "GET" },
        );
        if (!alive) return;
        setProject(initialProject);
        projectRef.current = initialProject;
        if (data.draft.title) {
          setTitle(data.draft.title);
          setSubtitle(data.draft.subtitle);
          setStyle(data.draft.style);
          setCount(data.draft.rankCount || 5);
        }
        if (data.result) {
          setResult(data.result);
          setShowResult(true);
          setBusy("");
          return;
        }
        if (data.status === "failed")
          throw new Error(data.error || "영상 제작을 완료하지 못했습니다.");
        if (!["queued", "running"].includes(data.status)) {
          setBusy("");
          return;
        }
        router.replace("/projects#ranking-project-list-title");
        if (alive) setBusy("");
      } catch (error) {
        if (alive) {
          setError(
            error instanceof Error
              ? error.message
              : "작업을 불러오지 못했습니다.",
          );
          setBusy("");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialProject, initialOperation, router]);
  const slot = slots[active];
  const visible = slots.slice(0, count);
  const descending = orderMode !== "asc";
  const order =
    orderMode === "custom"
      ? rankingOrderForCount(customOrder, count)
      : Array.from({ length: count }, (_, i) =>
          orderMode === "desc" ? count - i : i + 1,
        );
  function applyOrder(next: number[]) {
    setCustomOrder(next);
    setOrderMode(
      next.every((rank, index) => rank === next.length - index)
        ? "desc"
        : next.every((rank, index) => rank === index + 1)
          ? "asc"
          : "custom",
    );
    setResult(null);
    setShowResult(false);
  }
  const ready = visible.filter((item) => item.source).length;
  const total = visible.reduce(
    (sum, item) => sum + (item.source ? item.end - item.start : 0),
    transitionSeconds(transitionSound, ready),
  );
  const overLimit = total > RANKING_LIMITS.outputSeconds;
  const hasRemote = visible.some(
    (item) => item.source?.remote && !item.source.previewReady,
  );
  const remoteSource = slot.source?.remote && !slot.source.previewReady;
  const manualRange =
    remoteSource && slot.source?.remote?.platform === "instagram";
  useEffect(() => {
    if (busy) {
      player.current?.pause();
      remotePlayer.current?.pause();
    }
  }, [busy]);

  function patch(index: number, changes: Partial<Slot>) {
    setSlots((previous) =>
      previous.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
    setResult(null);
    setShowResult(false);
    setError("");
  }

  async function task(message: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(message);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "처리하지 못했습니다.",
      );
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function ensureProject() {
    if (projectRef.current) return projectRef.current;
    const created = await requestJson("/api/ranking-shorts", { method: "POST" });
    const id = created.id as string;
    projectRef.current = id;
    setProject(id);
    return id;
  }

  function receiveDuration(index: number, sourceId: string, duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setSlots((previous) => previous.map((item, i) => {
      if (i !== index || item.source?.id !== sourceId || !item.pendingLink) return item;
      if (item.source.durationKnown && item.source.duration === duration) return item;
      const start = Math.min(item.start, Math.max(0, duration - 0.5));
      const end = Math.min(duration, Math.max(start + 0.5, item.end));
      return { ...item, start, end, source: { ...item.source, duration, durationKnown: true } };
    }));
    if (duration > RANKING_LIMITS.sourceSeconds)
      setError(`${index + 1}위 원본 영상은 20분 이하여야 합니다.`);
  }

  async function importSource(file?: File) {
    if (busyRef.current) return;
    const index = active;
    const remote = !file ? rankingDirectRemote(slots[index].link) : null;
    if (remote) {
      patch(index, {
        source: {
          id: crypto.randomUUID(), remote, duration: 0, durationKnown: false,
          width: 0, height: 0, hasAudio: true, previewReady: false,
        },
        pendingLink: true, start: 0, end: 10,
      });
      setCurrent(0);
      return;
    }
    if (file && file.size > RANKING_LIMITS.sourceBytes) {
      setError("250MB 이하의 영상 파일을 선택해 주세요.");
      return;
    }
    await task(
      file
        ? `${index + 1}위 영상을 업로드하고 미리보기를 준비하고 있습니다…`
        : `${index + 1}위 영상의 구간 선택을 준비하고 있습니다…`,
      async () => {
        const id = await ensureProject();
        const requestId = crypto.randomUUID();
        const input = file
          ? { requestId, size: file.size }
          : { requestId, url: slots[index].link.trim() };
        let queued = await requestJson(`/api/ranking-shorts/${id}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const preparingDeadline = Date.now() + 5 * 60_000;
        while (queued.preparing && Date.now() < preparingDeadline) {
          setBusy("영상 처리기를 시작하고 있습니다…");
          await pause(5000);
          queued = await requestJson(`/api/ranking-shorts/${id}/sources`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          });
        }
        if (queued.preparing)
          throw new Error(
            "영상 처리기가 준비 중입니다. 잠시 후 다시 시도해 주세요.",
          );
        if (file) {
          setBusy(`${index + 1}위 영상을 업로드하고 있습니다…`);
          let uploaded: Response;
          try {
            uploaded = await fetch(queued.upload.url, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${queued.upload.token}`,
                "Content-Type": "application/octet-stream",
              },
              body: file,
              signal: AbortSignal.timeout(600_000),
            });
            if (!uploaded.ok) throw new Error("UploadFailed");
          } catch {
            const cancelled = await fetch(queued.pollUrl, {
              method: "DELETE",
            }).catch(() => null);
            if (cancelled?.status !== 409)
              throw new Error(
                "영상을 업로드하지 못했습니다. 다시 추가해 주세요.",
              );
          }
        }
        setBusy(`${index + 1}위 영상의 구간 선택을 준비하고 있습니다…`);
        const data = await waitForOperation(queued);
        const source = data.source as RankingSource;
        setCurrent(0);
        patch(index, { source, pendingLink: false, start: 0, end: Math.min(10, source.duration) });
        if (source.durationKnown === false) {
          setBusy(
            `${index + 1}위 영상을 가져와 구간 선택을 준비하고 있습니다…`,
          );
          await prepareSource(id, source.id, index, 0, 10);
        }
      },
    );
  }

  async function uploadMusic(file: File) {
    if (!file.size || file.size > 30 * 1024 * 1024) {
      setError("배경음악은 30MB 이하 파일을 선택해 주세요."); return;
    }
    await task("배경음악을 준비하고 있습니다…", async () => {
      const id = await ensureProject();
      const input = {requestId: crypto.randomUUID(), size: file.size, kind: "audio"};
      const queue = () => requestJson(`/api/ranking-shorts/${id}/sources`, {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(input),
      });
      let queued = await queue();
      const deadline = Date.now() + 300_000;
      while (queued.preparing && Date.now() < deadline) {await pause(5000); queued = await queue();}
      if (queued.preparing) throw new Error("처리기가 준비 중입니다. 잠시 후 다시 시도해 주세요.");
      try {
        const uploaded = await fetch(queued.upload.url, {method: "PUT",
          headers: {Authorization: `Bearer ${queued.upload.token}`, "Content-Type": "application/octet-stream"},
          body: file, signal: AbortSignal.timeout(300_000)});
        if (!uploaded.ok) throw new Error("배경음악을 업로드하지 못했습니다.");
      } catch (error) {
        const cancelled = await fetch(queued.pollUrl, {method: "DELETE"}).catch(() => null);
        if (cancelled?.status !== 409) throw error;
      }
      const data = await waitForOperation(queued);
      setMusic({id: data.source.id, name: file.name});
      setMusicEnabled(true); setResult(null); setShowResult(false);
    });
  }

  function invalidateAudio() {setResult(null); setShowResult(false);}

  async function render() {
    const parsed = rankingRenderSchema.safeParse({
      title,
      transitionSound,
      backgroundMusic,
      subtitle,
      style,
      descending,
      playbackOrder: order.filter((rank) => visible[rank - 1].source),
      rankCount: count,
      clips: visible.flatMap((item, i) =>
        item.source
          ? [
              {
                rank: i + 1,
                sourceId: item.source.id,
                label: item.label,
                start: item.start,
                end: item.end,
              },
            ]
          : [],
      ),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    await task("작업을 접수하고 있습니다…", async () => {
      const id = await ensureProject();
      const links = visible.flatMap((item) => item.pendingLink && item.source?.remote
        ? [{ sourceId: item.source.id, url: item.source.remote.url }] : []);
      const key = JSON.stringify({ projectId: id, spec: parsed.data, links });
      if (submission.current?.key !== key)
        submission.current = { key, requestId: crypto.randomUUID() };
      await requestJson(`/api/ranking-shorts/${id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: submission.current.requestId, spec: parsed.data, links }),
      });
      // The durable render operation owns downloading and assembly from here.
      // Navigating away or closing the tab cannot interrupt the job.
      router.push("/projects#ranking-project-list-title");
      router.refresh();
    });
  }

  async function prepareSource(
    projectId: string,
    sourceId: string,
    index: number,
    previousStart: number,
    previousEnd: number,
  ) {
    const queued = await requestJson(
      `/api/ranking-shorts/${projectId}/sources/${sourceId}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      },
    );
    const data = await waitForOperation(queued);
    const source = data.source as RankingSource;
    const start = Math.min(previousStart, Math.max(0, source.duration - 0.5));
    const end = Math.min(
      source.duration,
      start + 60,
      Math.max(start + 0.5, previousEnd),
    );
    patch(index, { source, start, end });
    setCurrent(start);
  }

  function seek(seconds: number) {
    if (remoteSource) {
      remotePlayer.current?.seek(seconds);
      setCurrent(seconds);
      return;
    }
    const video = player.current;
    if (!video) return;
    video.pause();
    video.currentTime = seconds;
    setCurrent(seconds);
  }
  const sourceUrl =
    slot.source && !remoteSource && project
      ? `/api/ranking-shorts/${project}/media/${slot.source.id}`
      : "";
  const canRender =
    !busy &&
    ready > 0 &&
    !overLimit &&
    Boolean(title.trim()) &&
    !visible.some((item) => item.source && (
      item.source.durationKnown === false || item.source.duration > RANKING_LIMITS.sourceSeconds
    ));

  function updateStyle(changes: Partial<RankingStyle>) {
    setStyle((previous) => ({ ...previous, ...changes }));
    setResult(null);
    setShowResult(false);
  }
  const colors = rankingColors(style);
  const sequence = rankingAudioSequence(visible
    .flatMap((item, i) =>
      item.source
        ? [
            {
              rank: i + 1,
              sourceId: item.source.id,
              start: item.start,
              end: item.end,
            },
          ]
        : [],
    )
    .sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank)), transitionSound);
  const sequenceKey = sequence
    .map((item) => `${item.rank}:${item.sourceId}:${item.start}:${item.end}`)
    .join("|");

  if (initialProject && result)
    return (
      <main className="ranking-studio ranking-completed">
        <header className="ranking-heading">
          <div>
            <div className="ranking-eyebrow">관리자 전용</div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <Link href="/ranking-shorts" className="ranking-reset">
            새 랭킹 만들기
          </Link>
        </header>
        <div className="ranking-output-player">
          <video
            controls
            playsInline
            src={result.url}
            aria-label="완성된 랭킹 쇼츠"
          />
        </div>
        <p>{result.duration.toFixed(1)}초 · 720 × 1280 · MP4</p>
        <a
          className="ranking-download-button"
          href={`${result.url}&download=1`}
          download="ranking-shorts.mp4"
        >
          영상 다운로드 ↓
        </a>
      </main>
    );

  return (
    <main className="ranking-studio">
      <header className="ranking-heading">
        <div>
          <div className="ranking-eyebrow">
            CREATIVE STUDIO <span>관리자 전용</span>
          </div>
          <h1>랭킹 쇼츠</h1>
          <p>순위를 채우고, 가장 좋은 순간만 남기세요.</p>
        </div>
        <div className="ranking-heading-actions"><RankingExamples />
        <button
          type="button"
          className="ranking-reset"
          disabled={Boolean(busy)}
          onClick={() => {
            void task("작업을 정리하고 있습니다…", async () => {
              if (projectRef.current && !result)
                await requestJson(`/api/ranking-shorts/${projectRef.current}`, {
                  method: "DELETE",
                });
              window.history.replaceState(null, "", "/ranking-shorts");
              projectRef.current = null;
              setProject(null);
              setMusic(null);
              setMusicEnabled(false);
              setSoundEnabled(false);
              setMusicVolume(0.15);
              setSlots(emptySlots());
              setActive(0);
              setResult(null);
              setCurrent(0);
            });
          }}
        >
          새로 시작
        </button>
      </div>
      </header>

      <div className="ranking-workspace">
        <div className="ranking-edit-column">
          <section
            className="ranking-settings"
            aria-labelledby="ranking-settings-heading"
          >
            <div className="ranking-section-heading">
              <h2 id="ranking-settings-heading">제목</h2>
              <button
                type="button"
                className="ranking-design-toggle"
                disabled={Boolean(busy)}
                aria-expanded={designOpen}
                aria-controls="ranking-design-settings"
                onClick={() => {
                  setDesignOpen((open) => !open);
                  setCustomDesignOpen(false);
                }}
              >
                디자인 설정{" "}
                <svg
                  className="ranking-design-chevron"
                  viewBox="0 0 20 20"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <path
                    d="m5 7 5 5 5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <fieldset disabled={Boolean(busy)}>
              <div className="ranking-title-fields">
                <label>
                  첫째 줄
                  <input
                    value={title}
                    maxLength={80}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setResult(null);
                    }}
                    placeholder="예: 역대급 팔씨름"
                  />
                </label>
                <label>
                  둘째 줄
                  <div className="ranking-subtitle-input">
                    <input
                      value={subtitle}
                      maxLength={60}
                      onChange={(event) => {
                        setSubtitle(event.target.value);
                        setResult(null);
                      }}
                      placeholder="예: 랭킹 갓"
                    />
                    <span>TOP{count}</span>
                  </div>
                </label>
              </div>
              {designOpen ? (
                <div
                  id="ranking-design-settings"
                  className="ranking-design-panel"
                >
                  <div className="ranking-template-label">스타일</div>
                  <div
                    className="ranking-template-grid"
                    aria-label="랭킹 템플릿"
                  >
                    {(
                      Object.keys(
                        rankingDesign.templates,
                      ) as RankingStyle["template"][]
                    ).map((id) => {
                      const preset = rankingPreset(id);
                      const template = rankingDesign.templates[id];
                      const palette = rankingDesign.palettes[preset.palette];
                      const selected =
                        style.template === id &&
                        style.font === preset.font &&
                        style.palette === preset.palette &&
                        colors.title === palette.title &&
                        colors.subtitle === palette.subtitle &&
                        colors.accent === palette.accent;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-label={`${template.label} 템플릿`}
                          aria-pressed={selected}
                          className={`ranking-template-card ${selected ? "is-active" : ""}`}
                          onClick={() =>
                            updateStyle({ ...preset, position: style.position })
                          }
                        >
                          <svg
                            className="ranking-style-sample"
                            viewBox="0 0 180 64"
                            aria-hidden="true"
                            style={{
                              fontFamily:
                                rankingDesign.fonts[preset.font].family,
                            }}
                          >
                            <text
                              x="90"
                              y="26"
                              textAnchor="middle"
                              fontSize="22"
                              fill={palette.title}
                            >
                              오늘의 랭킹
                            </text>
                            <text
                              x="90"
                              y="53"
                              textAnchor="middle"
                              fontSize="24"
                              fill={palette.accent}
                            >
                              TOP 5
                            </text>
                          </svg>
                          <span className="ranking-style-name">
                            {template.label}
                            {selected ? (
                              <span aria-hidden="true">✓</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="ranking-design-actions">
                    <div
                      className="ranking-position-toggle"
                      role="group"
                      aria-label="랭킹 위치"
                    >
                      <span>랭킹 위치</span>
                      <button
                        type="button"
                        aria-pressed={style.position === "left"}
                        onClick={() => updateStyle({ position: "left" })}
                      >
                        왼쪽
                      </button>
                      <button
                        type="button"
                        aria-pressed={style.position === "right"}
                        onClick={() => updateStyle({ position: "right" })}
                      >
                        오른쪽
                      </button>
                    </div>
                    <button
                      type="button"
                      className="ranking-custom-toggle"
                      aria-expanded={customDesignOpen}
                      aria-controls="ranking-custom-design"
                      onClick={() => setCustomDesignOpen((open) => !open)}
                    >
                      직접 꾸미기{" "}
                      <span aria-hidden="true">
                        {customDesignOpen ? "⌃" : "⌄"}
                      </span>
                    </button>
                  </div>
                  {customDesignOpen ? (
                    <div
                      id="ranking-custom-design"
                      className="ranking-custom-design"
                    >
                      <div className="ranking-custom-font">
                        <span className="ranking-field-label">폰트</span>
                        <RankingSelect
                          label="제목 폰트"
                          value={style.font}
                          disabled={Boolean(busy)}
                          options={Object.entries(rankingDesign.fonts).map(
                            ([value, font]) => ({ value, label: font.label }),
                          )}
                          onChange={(font) =>
                            updateStyle({ font: font as RankingStyle["font"] })
                          }
                        />
                      </div>
                      <div className="ranking-individual-colors">
                        <RankingColorField
                          label="첫째 줄 색상"
                          value={colors.title}
                          onChange={(titleColor) => updateStyle({ titleColor })}
                          disabled={Boolean(busy)}
                        />
                        <RankingColorField
                          label="둘째 줄 색상"
                          value={colors.subtitle}
                          onChange={(subtitleColor) =>
                            updateStyle({ subtitleColor })
                          }
                          disabled={Boolean(busy)}
                        />
                        <RankingColorField
                          label="TOP 색상"
                          value={colors.accent}
                          onChange={(accentColor) =>
                            updateStyle({ accentColor })
                          }
                          disabled={Boolean(busy)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="ranking-options">
                <div>
                  <span className="ranking-field-label">순위</span>
                  <RankingSelect
                    label="몇 위까지 만들까요?"
                    value={String(count)}
                    disabled={Boolean(busy)}
                    options={Array.from({ length: 10 }, (_, i) => ({
                      value: String(i + 1),
                      label: `${i + 1}위까지`,
                    }))}
                    onChange={(next) => {
                      const value = Number(next);
                      setCustomOrder(rankingOrderForCount(order, value));
                      setCount(value);
                      setActive((previous) => Math.min(previous, value - 1));
                      setResult(null);
                    }}
                  />
                </div>
                <div className="ranking-order-field">
                  <button
                    className="ranking-order-trigger"
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={orderOpen}
                    onClick={() => setOrderOpen(true)}
                  >
                    <span>재생 순서</span>
                    <svg
                      viewBox="0 0 20 20"
                      width="18"
                      height="18"
                      aria-hidden="true"
                    >
                      <path
                        d="m5 7 5 5 5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <RankingAudioSettings sound={sound} enabled={soundEnabled}
                onSound={(value) => {setSound(value); invalidateAudio();}}
                onEnabled={(value) => {setSoundEnabled(value); invalidateAudio();}}
                music={music} musicEnabled={musicEnabled} onMusicEnabled={(value) => {setMusicEnabled(value); invalidateAudio();}}
                onUpload={uploadMusic} onRemove={() => {setMusic(null); invalidateAudio();}}
                volume={musicVolume} onVolume={(value) => {setMusicVolume(value); invalidateAudio();}}
                disabled={Boolean(busy)} project={project} />
            </fieldset>
          </section>

          <section
            className="ranking-clips"
            aria-labelledby="ranking-clips-heading"
          >
            <div className="ranking-section-heading">
              <h2 id="ranking-clips-heading">
                순위별 장면{" "}
                <small>
                  {ready}/{count}
                </small>
              </h2>
            </div>
            <div className="ranking-rank-tabs" aria-label="순위별 영상">
              {visible.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setActive(index);
                    setCurrent(item.start);
                  }}
                  aria-pressed={active === index}
                  className={active === index ? "is-active" : ""}
                >
                  <span>
                    {index + 1}
                    <small>위</small>
                  </span>
                  <i
                    className={item.source ? "is-ready" : ""}
                    aria-label={item.source ? "영상 준비됨" : "영상 없음"}
                  />
                </button>
              ))}
            </div>
            <div className="ranking-clip-body">
              <fieldset
                disabled={Boolean(busy)}
                className="ranking-source-fields"
              >
                <label>
                  순위 이름
                  <input
                    aria-label={`${active + 1}위 이름`}
                    maxLength={60}
                    placeholder="이 장면의 이름을 적어 주세요"
                    value={slot.label}
                    onChange={(event) =>
                      patch(active, { label: event.target.value })
                    }
                  />
                </label>
                <span className="ranking-source-label">
                  영상 링크 또는 파일
                </span>
                <div className="ranking-import-row">
                  <input
                    aria-label="영상 링크"
                    type="url"
                    value={slot.link}
                    onChange={(event) =>
                      patch(active, { link: event.target.value })
                    }
                    placeholder="쇼츠 · 릴스 · 틱톡 링크 붙여넣기"
                  />
                  <button
                    type="button"
                    disabled={!slot.link.trim() || Boolean(busy)}
                    onClick={() => void importSource()}
                  >
                    구간 선택하기
                  </button>
                  <label className="ranking-file-button">
                    <svg
                      viewBox="0 0 20 20"
                      width="18"
                      height="18"
                      aria-hidden="true"
                    >
                      <path
                        d="M10 13V3m-4 4 4-4 4 4M4 12v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    파일 선택
                    <input
                      type="file"
                      accept="video/*,.mkv"
                      aria-label={`${active + 1}위 영상 파일`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void importSource(file);
                      }}
                    />
                  </label>
                </div>
              </fieldset>
              {slot.source ? (
                <>
                  {remoteSource && slot.source.remote ? (
                    <RankingRemotePlayer
                      key={slot.source.id}
                      ref={remotePlayer}
                      remote={slot.source.remote}
                      start={slot.start}
                      label={`${active + 1}위 원본 플레이어`}
                      suspended={Boolean(busy)}
                      onPlaying={(value) => {
                        if (value)
                          setPreviewPauseSignal((previous) => previous + 1);
                      }}
                      onTime={setCurrent}
                      onDuration={(duration) => receiveDuration(active, slot.source!.id, duration)}
                      onUnavailable={() => {
                        const sourceId = slot.source?.id;
                        if (slot.source?.remote?.platform !== "instagram" || !project || !sourceId || busyRef.current || previewFallbacks.current.has(sourceId)) return;
                        previewFallbacks.current.add(sourceId);
                        void task(
                          `${active + 1}위 영상을 가져와 구간 선택을 준비하고 있습니다…`,
                          () => prepareSource(project, sourceId, active, slot.start, slot.end),
                        );
                      }}
                    />
                  ) : (
                    <div className="ranking-source-player">
                      <video
                        key={sourceUrl + active}
                        ref={player}
                        src={sourceUrl}
                        controls
                        playsInline
                        preload="metadata"
                        aria-label={`${active + 1}위 원본 영상`}
                        onLoadedMetadata={(event) => {
                          event.currentTarget.currentTime = slot.start;
                          setCurrent(slot.start);
                        }}
                        onTimeUpdate={(event) =>
                          setCurrent(event.currentTarget.currentTime)
                        }
                        onPlay={() =>
                          setPreviewPauseSignal((value) => value + 1)
                        }
                        onError={() =>
                          setError(
                            "원본 영상을 불러오지 못했습니다. 다시 가져와 주세요.",
                          )
                        }
                      />
                    </div>
                  )}
                  <div className="ranking-source-status">
                    <span>
                      <i />
                      {slot.source.previewReady
                        ? "영상 준비됨"
                        : slot.pendingLink
                          ? slot.source.durationKnown === false
                            ? "플레이어에서 재생하면 영상 길이가 표시됩니다"
                            : "영상 만들기를 누르면 다운로드합니다"
                          : slot.source.durationKnown === false
                          ? busy
                            ? "구간 선택 준비 중…"
                            : "영상을 가져오지 못했어요"
                          : remoteSource
                            ? "영상 만들기를 누르면 다운로드합니다"
                            : "영상 준비됨"}
                    </span>
                    <span>
                      {slot.source.durationKnown === false
                        ? ""
                        : `원본 ${rankingTime(slot.source.duration)} · `}
                      <button
                        disabled={Boolean(busy)}
                        type="button"
                        onClick={() => {
                          patch(active, { source: null, start: 0, end: 0 });
                          setCurrent(0);
                        }}
                      >
                        삭제
                      </button>
                    </span>
                  </div>
                  {manualRange && slot.source.durationKnown !== false ? (
                    <p className="ranking-hint">
                      릴스는 플레이어에서 장면을 확인한 뒤 아래 손잡이로 구간을
                      지정해 주세요. 타임라인 이동은 플레이어에 반영되지
                      않습니다.
                    </p>
                  ) : null}
                  {slot.source.durationKnown === false ? (
                    <div className="ranking-prepare-preview">
                      {slot.pendingLink ? null : busy ? (
                        <p className="ranking-hint">
                          영상 길이와 장면을 불러오고 있어요.
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const sourceId = slot.source?.id;
                            if (project && sourceId)
                              void task(
                                "구간 선택을 다시 준비하고 있습니다…",
                                () =>
                                  prepareSource(
                                    project,
                                    sourceId,
                                    active,
                                    slot.start,
                                    slot.end,
                                  ),
                              );
                          }}
                        >
                          다시 시도
                        </button>
                      )}
                    </div>
                  ) : (
                    <RankingTimeline
                      key={slot.source.id + active}
                      src={sourceUrl}
                      duration={slot.source.duration}
                      start={slot.start}
                      end={slot.end}
                      current={current}
                      disabled={Boolean(busy)}
                      onChange={(start, end) => patch(active, { start, end })}
                      onSeek={seek}
                    />
                  )}
                </>
              ) : (
                <div className="ranking-empty-source">
                  <div className="ranking-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28">
                      <rect
                        x="3"
                        y="5"
                        width="18"
                        height="14"
                        rx="3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      />
                      <path d="m10 9 5 3-5 3Z" fill="currentColor" />
                    </svg>
                  </div>
                  <strong>{active + 1}위에 들어갈 영상을 추가하세요</strong>
                  <p>
                    링크나 파일을 넣으면 바로 재생하며 구간을 고를 수 있어요.
                  </p>
                  <small>원본 최대 20분 · 250MB</small>
                </div>
              )}
            </div>
          </section>
          <p className="ranking-edit-note">
            순위 이름은 영상이 등장할 때 공개됩니다. 가로 영상은 중앙을 기준으로
            세로 화면에 맞춥니다.
          </p>
        </div>

        <aside
          className="ranking-preview-column"
          aria-label="완성 화면 미리보기"
        >
          <div className="ranking-section-heading">
            <h2>
              {result && showResult
                ? "완성 영상"
                : hasRemote
                  ? "레이아웃 미리보기"
                  : "전체 미리보기"}
            </h2>
            <span>{result && showResult ? "렌더 완료" : "9:16"}</span>
          </div>
          {result && showResult ? (
            <div className="ranking-output-player">
              <video
                controls
                playsInline
                src={result.url}
                aria-label="완성된 랭킹 쇼츠"
              />
            </div>
          ) : null}
          <div hidden={Boolean(result && showResult)}>
            <RankingSequencePreview
              key={sequenceKey + hasRemote + transitionSound + backgroundMusic?.sourceId + backgroundMusic?.volume}
              layoutOnly={hasRemote}
              clips={sequence}
              backgroundMusic={backgroundMusic}
              project={project}
              title={title}
              subtitle={subtitle}
              count={count}
              labels={visible.map((item) => item.label)}
              previewSource={slot.source || undefined}
              previewStart={slot.start}
              previewRank={active + 1}
              descending={descending}
              style={style}
              suspended={Boolean(busy || (result && showResult))}
              pauseSignal={previewPauseSignal}
              onStart={() => {
                player.current?.pause();
                remotePlayer.current?.pause();
              }}
            />
          </div>
          {result ? (
            <div className="ranking-preview-caption">
              <span>{showResult ? "720 × 1280 · MP4" : ""}</span>
              <button type="button" onClick={() => setShowResult(!showResult)}>
                {showResult
                  ? hasRemote
                    ? "레이아웃 미리보기"
                    : "전체 미리보기"
                  : "완성 영상 보기"}
              </button>
            </div>
          ) : null}
          <div className="ranking-export-summary">
            <span>전체 길이</span>
            <strong className={overLimit ? "is-over" : ""}>
              {total.toFixed(1)}
              <small> / 180초</small>
            </strong>
          </div>
          {overLimit ? (
            <p role="alert" className="ranking-error">
              사용 구간을 줄여 총 180초 이하로 맞춰 주세요.
            </p>
          ) : null}
          {result ? (
            <a
              className="ranking-download-button"
              href={`${result.url}&download=1`}
              download="ranking-shorts.mp4"
            >
              영상 다운로드 ↓
            </a>
          ) : (
            <button
              type="button"
              className="ranking-export-button"
              disabled={!canRender}
              onClick={() => {
                player.current?.pause();
                remotePlayer.current?.pause();
                void render();
              }}
            >
              {busy ? "처리 중…" : "영상 만들기"}
              <span>↗</span>
            </button>
          )}
        </aside>
      </div>
      <div className="ranking-notices" aria-live="polite">
        {error ? (
          <p role="alert" className="ranking-error">
            {error}
          </p>
        ) : null}
      </div>
      {busy ? <RankingProgressOverlay message={busy} /> : null}
      {orderOpen ? (
        <RankingOrderEditor
          order={order}
          labels={visible.map((item) => item.label)}
          onChange={applyOrder}
          onClose={() => setOrderOpen(false)}
        />
      ) : null}
      <details
        className="ranking-history"
        onToggle={(event) => {
          if (event.currentTarget.open)
            void requestJson("/api/ranking-shorts", { method: "GET" })
              .then((data) => setHistory(data.projects))
              .catch(() => setError("최근 작업을 불러오지 못했습니다."));
        }}
      >
        <summary>최근 작업</summary>
        <div>
          {history.length ? (
            history.map((item) => (
              <div className="ranking-history-row" key={item.id}>
                <a href={`/ranking-shorts?project=${item.id}`}>
                  {item.title || "랭킹 쇼츠"}
                  <span>
                    {item.status === "succeeded"
                      ? "완료"
                      : item.status === "failed"
                        ? "실패"
                        : item.status === "draft"
                          ? "미완료"
                          : "제작 중"}
                  </span>
                </a>
                <button
                  type="button"
                  disabled={
                    Boolean(busy) ||
                    ["queued", "running"].includes(item.status) ||
                    item.id === project
                  }
                  aria-label={`${item.title || "랭킹 쇼츠"} 작업 삭제`}
                  onClick={() =>
                    void task("작업을 정리하고 있습니다…", async () => {
                      await requestJson(`/api/ranking-shorts/${item.id}`, {
                        method: "DELETE",
                      });
                      setHistory((previous) =>
                        previous.filter((row) => row.id !== item.id),
                      );
                    })
                  }
                >
                  삭제
                </button>
              </div>
            ))
          ) : (
            <p>아직 제작한 영상이 없어요.</p>
          )}
        </div>
      </details>
      <footer className="ranking-test-note">
        완료되면 이메일로 알려드려요. 완성 영상은 30일간 보관됩니다.
      </footer>
    </main>
  );
}
