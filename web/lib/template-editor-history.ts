export type TemplateEditorDraft = {
  boardName: string; title: string; body: string[]; tags: string[];
  brandColor: string; channel: string; avatar: string | null; assetKey: string | null;
  start: number; end: number;
};
export type TemplateEditorHistory = {
  present: TemplateEditorDraft; baseline: TemplateEditorDraft;
  past: TemplateEditorDraft[]; future: TemplateEditorDraft[]; group: string | null;
};
export type TemplateEditorAction =
  | { type: "edit"; patch: Partial<TemplateEditorDraft>; group?: string }
  | { type: "undo" | "redo" | "checkpoint" | "saved" }
  | { type: "reset"; value: TemplateEditorDraft };
export function createTemplateEditorHistory(value: TemplateEditorDraft): TemplateEditorHistory {
  return { present: value, baseline: value, past: [], future: [], group: null };
}
export function templateEditorHistory(state: TemplateEditorHistory, action: TemplateEditorAction): TemplateEditorHistory {
  if (action.type === "reset") return createTemplateEditorHistory(action.value);
  if (action.type === "checkpoint") return { ...state, group: null };
  if (action.type === "saved") return { ...state, baseline: state.present, group: null };
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { ...state, present: previous, past: state.past.slice(0, -1), future: [state.present, ...state.future], group: null } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { ...state, present: next, past: [...state.past, state.present].slice(-100), future: state.future.slice(1), group: null } : state;
  }
  if (action.type !== "edit") return state;
  const present = { ...state.present, ...action.patch };
  if (JSON.stringify(present) === JSON.stringify(state.present)) return state;
  return { ...state, present,
    past: action.group && state.group === action.group ? state.past : [...state.past, state.present].slice(-100),
    future: [], group: action.group ?? null };
}
export function templateEditorDirty(state: TemplateEditorHistory) {
  return JSON.stringify(state.present) !== JSON.stringify(state.baseline);
}
