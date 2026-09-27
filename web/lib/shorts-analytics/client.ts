"use client";
import type { GuideEvent, GuideEventInput } from "./schema";
const KEY = "easycut:guide-analytics:v1";
const VERSION = "20260927";
const MAX_AGE = 86400000;
type State = {
  started?: boolean;
  surveyId: string;
  sequence: number;
  savedAt: number;
  pending: GuideEvent[];
};
let state: State | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
let retry = 0;
let listeners = false;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function persist() {
  if (!state) return;
  state.savedAt = Date.now();
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Memory-only fallback. */
  }
}
function load(): State {
  if (state) return state;
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (
      raw &&
      uuid.test(raw.surveyId) &&
      Number.isInteger(raw.sequence) &&
      raw.sequence >= 0 &&
      raw.sequence <= 500 &&
      raw.savedAt <= Date.now() &&
      Date.now() - raw.savedAt < MAX_AGE &&
      Array.isArray(raw.pending)
    ) {
      state = {
        ...raw,
        pending: raw.pending
          .filter(
            (e: GuideEvent) => e && uuid.test(e.id) && e.version === VERSION,
          )
          .slice(-60),
      };
    }
  } catch {
    /* Storage may be unavailable. */
  }
  state ??= {
    surveyId: crypto.randomUUID(),
    sequence: 0,
    savedAt: Date.now(),
    pending: [],
  };
  return state;
}
function schedule(delay = 80) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void flushGuideEvents();
  }, delay);
}
export function initializeGuideAnalytics() {
  if (typeof window === "undefined") return;
  try {
    load();
  } catch {
    return;
  }
  if (!listeners) {
    listeners = true;
    window.addEventListener("pagehide", () => {
      void flushGuideEvents();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushGuideEvents();
    });
  }
  if (state?.pending.length) schedule();
}
export function newGuideSurvey() {
  try {
    const current = load();
    current.surveyId = crypto.randomUUID();
    current.sequence = 0;
    current.started = false;
    persist();
  } catch {
    /* Analytics must never prevent a fresh questionnaire. */
  }
}
export function trackGuideEvent(input: GuideEventInput) {
  if (typeof window === "undefined") return;
  try {
    initializeGuideAnalytics();
    const current = load();
    if (current.sequence >= 500) return;
    const snapshot = JSON.parse(JSON.stringify(input.answers || {}));
    // Start is idempotent per attempt, even on refresh or language changes.
    if (input.name === "quiz_started" && current.started) return;
    if (input.name === "quiz_started") current.started = true;
    const event: GuideEvent = {
      ...input,
      answers: snapshot,
      id: crypto.randomUUID(),
      surveyId: current.surveyId,
      sequence: ++current.sequence,
      version: VERSION,
    };
    current.pending.push(event);
    if (current.pending.length > 60) {
      const expendable = current.pending.findIndex(
        (e) => e.name !== "quiz_started" && e.name !== "quiz_completed",
      );
      current.pending.splice(expendable < 0 ? 0 : expendable, 1);
    }
    persist();
    retry = 0;
    schedule();
  } catch {
    /* Questionnaire interactions always remain available. */
  }
}
export async function flushGuideEvents() {
  if (sending || !state?.pending.length) return;
  sending = true;
  const batch = state.pending.slice(0, 20);
  const ids = new Set(batch.map((e) => e.id));
  let more = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/shorts-monetization/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      credentials: "omit",
      keepalive: true,
      signal: controller.signal,
    });
    if (response.ok || [400, 403, 413, 415].includes(response.status)) {
      state.pending = state.pending.filter((e) => !ids.has(e.id));
      persist();
      retry = 0;
      more = state.pending.length > 0;
    } else if (retry++ < 1) schedule(response.status === 429 ? 60000 : 1500);
  } catch {
    if (retry++ < 1) schedule(1500);
  } finally {
    clearTimeout(timeout);
    sending = false;
  }
  if (more) schedule();
}
