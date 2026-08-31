import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TemplateEditor } from "@/app/templates/template-editor";
import { BackgroundAssetPicker } from "@/components/background-asset-picker";
import { CustomTemplateCanvasPreview } from "@/components/custom-template-canvas-preview";
import { notifyBackgroundAssetsChanged, uploadBackgroundAsset } from "@/lib/background-assets-client";
import { notifyTemplateLibraryChanged, subscribeTemplateLibraryChanges } from "@/lib/template-library-events";
import { I18nProvider } from "@/lib/i18n/provider";
import { koMessages } from "@/lib/i18n/messages";
import {
  createDefaultTemplateConfig,
  templateConfigSchema,
  type CustomTemplate,
  type TemplateConfig,
  type TemplateTextOverlay,
} from "@/lib/template-config";
import "@/app/globals.css";
import "@/app/editor-v2.css";

const BLUE_BACKGROUND = "11111111-1111-4111-8111-111111111111";

function sampleConfig(count = 2): TemplateConfig {
  const config = createDefaultTemplateConfig("comment-capture");
  const textOverlays: TemplateTextOverlay[] = Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    text: index === 0 ? "내 배경 + 텍스트\n\n한국어 줄바꿈 확인" : index === 1
      ? "저장한 배경은\n다시 사용할 수 있어요" : `고정 문구 ${index + 1}`,
    fontId: index % 2 ? "jua" : "pretendard",
    color: index % 2 ? "#FFD84D" : "#FFFFFF",
    effect: index % 2 ? "shadow" : "outline",
    offset: { x: 0, y: index === 0 ? -750 : index === 1 ? 690 : -600 + (index - 2) * 60 },
    width: 860,
    scale: index < 2 ? 0.8 : 0.5,
  }));
  return templateConfigSchema.parse({
    ...config,
    background: { kind: "uploaded_image", assetId: BLUE_BACKGROUND },
    textOverlays,
    layerOrder: ["video", "title", "comment", ...textOverlays.map((text) => `text:${text.id}`), "channel"],
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || `로컬 요청 실패 (${response.status})`);
  return payload as T;
}

function RangeEventDiagnostics() {
  const [events, setEvents] = useState<{ id: number; type: string; label: string; value: string; input: string; trusted: boolean }[]>([]);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const types = ["input", "change", "keydown", "keyup", "pointerdown", "pointerup", "pointercancel", "pointermove", "click"];
    const capture = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "range") return;
      if (event instanceof PointerEvent && event.type === "pointermove" && !event.buttons) return;
      // Copy the native value before React's delegated handlers. Defer only the
      // diagnostics display update; never change/prevent the event or input.
      const row = {
        id: ++sequence, type: event.type,
        label: target.getAttribute("aria-label") || "이름 없는 range",
        value: target.value,
        input: event instanceof KeyboardEvent ? event.key : event instanceof PointerEvent ? `buttons=${event.buttons}` : "—",
        trusted: event.isTrusted,
      };
      queueMicrotask(() => { if (active) setEvents((current) => [row, ...current].slice(0, 12)); });
    };
    for (const type of types) window.addEventListener(type, capture, true);
    return () => {
      active = false;
      for (const type of types) window.removeEventListener(type, capture, true);
    };
  }, []);
  return <details open aria-label="범위 입력 이벤트 진단" style={{ position: "fixed", bottom: 10, left: 10, zIndex: 1000, width: 540, maxWidth: "calc(100vw - 20px)", padding: 10, border: "1px solid #475569", borderRadius: 10, background: "rgba(15,23,42,.97)", color: "#e2e8f0", fontSize: 11 }}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>로컬 range 이벤트 진단 · React 처리 전 캡처 · {events.length}건</summary>
    <p style={{ margin: "6px 0", color: "#94a3b8" }}>최신 이벤트가 위입니다. input/change가 없으면 네이티브 값 변경이 발생하지 않은 상태입니다.</p>
    <div style={{ maxHeight: 210, overflow: "auto" }}>
      <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
        <thead><tr><th>순서</th><th>종류</th><th>aria-label</th><th>target.value</th><th>키/포인터</th><th>trusted</th></tr></thead>
        <tbody>{events.map((event) => <tr key={event.id} style={{ borderTop: "1px solid #334155" }}><td>{event.id}</td><td>{event.type}</td><td>{event.label}</td><td>{event.value}</td><td>{event.input}</td><td>{String(event.trusted)}</td></tr>)}</tbody>
      </table>
      {!events.length && <p>범위 슬라이더를 클릭하거나 방향키로 조작해 주세요.</p>}
    </div>
    <button type="button" className="harness-button" style={{ marginTop: 6 }} onClick={() => setEvents([])}>진단 기록 비우기</button>
  </details>;
}

function Harness() {
  const [template, setTemplate] = useState<CustomTemplate | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("로컬 합성 데이터를 준비하고 있습니다.");
  const [pickedBackground, setPickedBackground] = useState<TemplateConfig["background"]>({ kind: "uploaded_image", assetId: BLUE_BACKGROUND });

  const refresh = useCallback(async () => {
    const { templates } = await requestJson<{ templates: CustomTemplate[] }>("/api/templates");
    if (templates[0]) {
      setTemplate(templates[0]);
      setStatus(`메모리 저장 버전 ${templates[0].version} · 고정 문구 ${templates[0].config.textOverlays?.length || 0}개 · 카드 최신 반영`);
      return;
    }
    const { template: created } = await requestJson<{ template: CustomTemplate }>("/api/templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "로컬 합성 템플릿", baseTemplateId: "comment-capture", config: sampleConfig() }),
    });
    setTemplate(created);
    setStatus("한국어 문구 2개와 합성 배경을 불러왔습니다.");
  }, []);

  useEffect(() => {
    const reload = () => { void refresh().catch((cause: unknown) => setError(String(cause))); };
    reload();
    const unsubscribe = subscribeTemplateLibraryChanges(reload);
    window.addEventListener("focus", reload);
    return () => { unsubscribe(); window.removeEventListener("focus", reload); };
  }, [refresh]);

  async function control(payload: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await requestJson("/__harness/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setStatus(message);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function replaceScenario(count: number) {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/templates/${template.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `로컬 합성 템플릿 · 문구 ${count}개`, config: sampleConfig(count), version: template.version }),
      });
      notifyTemplateLibraryChanged();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function uploadSynthetic() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/__harness/sample.png");
      const file = new File([await response.blob()], "로컬-합성-업로드.png", { type: "image/png" });
      await uploadBackgroundAsset(file);
      notifyBackgroundAssetsChanged();
      setStatus("합성 PNG가 메모리 목록에 업로드되었습니다. 편집 패널의 내 배경에도 함께 표시됩니다.");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return <>
    <RangeEventDiagnostics />
    <header id="harness-heading">
      <h1>로컬 화면 검증·운영 데이터 연결 없음</h1>
      <p>실제 TemplateEditor·공유 배경 선택기·미리보기 컴포넌트를 사용합니다. API는 이 서버의 메모리만 사용하고, DB·S3·AWS·로그인 계정은 연결하지 않습니다. 서버를 끄면 테스트 저장 내용은 사라집니다.</p>
      <p>1024px 이상에서 확인해 주세요. 템플릿을 저장하면 아래 세 카드가 같은 최신 스냅샷으로 바뀝니다. 배경은 두 선택기에서 함께 조회·재사용·목록 제거할 수 있습니다.</p>
      <div id="harness-toolbar">
        <button type="button" className="harness-button" disabled={busy || pickerBusy} onClick={() => setFeatureEnabled((value) => !value)}>{featureEnabled ? "기능 OFF 화면 보기" : "관리자 기능 ON"}</button>
        <button type="button" className="harness-button" disabled={busy || !template} onClick={() => void replaceScenario(2)}>문구 2개로 초기화</button>
        <button type="button" className="harness-button" disabled={busy || !template} onClick={() => void replaceScenario(20)}>문구 20개 경계</button>
        <button type="button" className="harness-button" disabled={busy || !featureEnabled} onClick={() => void uploadSynthetic()}>합성 PNG 업로드 테스트</button>
        <button type="button" className="harness-button" disabled={busy} onClick={() => void control({ failNextUpload: true }, "다음 업로드만 의도적으로 실패합니다. 기존 배경이 유지되어야 합니다.")}>다음 업로드 실패</button>
        <button type="button" className="harness-button" disabled={busy} onClick={() => void control({ failNextRead: true }, "다음 이미지 선택 검증만 의도적으로 실패합니다. 기존 배경이 유지되어야 합니다.")}>다음 선택 실패</button>
        <button type="button" className="harness-button" disabled={busy} onClick={() => void control({ delayMs: 1800 }, "업로드·선택 검증을 1.8초 지연합니다. 기다리는 동안 저장이 비활성인지 확인해 주세요.")}>지연 1.8초</button>
        <button type="button" className="harness-button" disabled={busy} onClick={() => void control({ delayMs: 0, failNextUpload: false, failNextRead: false }, "지연·의도한 실패를 해제했습니다.")}>오류·지연 해제</button>
      </div>
      <p id="harness-status" role="status">{status}</p>
    </header>
    {error && <p id="harness-error" role="alert">{error}</p>}
    {template && <>
      <section id="harness-library" aria-label="저장 후 세 위치의 동일 미리보기">
        <div>
          <h2>저장된 최신 미리보기 · 버전 {template.version}</h2>
          <div className="harness-cards">
            {["템플릿 페이지", "홈 템플릿 선택", "즐겨찾기"].map((label) => <button
              key={label} type="button" className="harness-card" aria-label={`${label} 미리보기 카드`}
              onClick={() => setStatus(`${label}: 저장 버전 ${template.version}의 동일한 읽기 전용 미리보기입니다.`)}
            >
              <CustomTemplateCanvasPreview template={template} firstLine="댓글 반응과 함께" secondLine="시청 지속시간 상승" channelLabel="로컬 테스트 채널" positionedWordsV4Enabled />
              <span className="harness-card-label">{label} · v{template.version}</span>
            </button>)}
          </div>
        </div>
        <div id="harness-picker">
          <h2>편집 화면과 공유하는 내 배경</h2>
          <BackgroundAssetPicker value={pickedBackground} onSelect={setPickedBackground} onRestore={() => setPickedBackground({ kind: "color", color: "#000000" })} onBusyChange={setPickerBusy} canUpload={featureEnabled} />
          <p style={{ marginTop: 10, fontSize: 11, color: "#cbd5e1" }}>선택값: {pickedBackground.kind === "uploaded_image" ? pickedBackground.assetId : "기본 배경"} {pickerBusy ? "· 확인 중" : ""}</p>
        </div>
      </section>
      <section id="harness-editor" aria-label="실제 템플릿 편집기">
        <TemplateEditor key={`${template.id}:${template.version}:${featureEnabled}`} initialTemplate={template} baseTemplateId={template.baseTemplateId} initialConfig={template.config} customTemplateDesignEnabled={featureEnabled} />
      </section>
    </>}
  </>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Local harness root is missing");
createRoot(root).render(<I18nProvider locale="ko" messages={koMessages}><Harness /></I18nProvider>);
