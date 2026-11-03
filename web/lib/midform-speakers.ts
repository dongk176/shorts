import type { MidformDraft, MidformRow } from "./midform-local";

export const speakerColors = ["#69d6b0", "#83bfff", "#e7a0cd", "#efc570", "#baa0f4", "#f29e83"];
export function initialSpeakerNames(rows: MidformRow[], names: Record<string, string> = {}, previous: Record<string, string> = {}) {
  let number = 0;
  return { ...names, ...Object.fromEntries([...new Set(rows.map(row => row.speaker))].map(key => {
    const fallback = key === "unknown" ? "미확인" : key === "overlap" ? "겹친 음성" : `화자 ${++number}`;
    return [key, names[key] || previous[key] || fallback];
  })) };
}
export function speakerKeys(draft: MidformDraft) {
  // JSONB object keys are reordered on save; dialogue order survives reopening.
  return [...new Set([...draft.rows.map(row => row.speaker), ...Object.keys(draft.names).sort()])];
}
export function speakerAppearance(key: string, keys: string[]) {
  if (key === "unknown") return { badge: "?", color: "#a5a9b1" };
  if (key === "overlap") return { badge: "≋", color: "#a5a9b1" };
  const index = Math.max(0, keys.filter(k => !["unknown", "overlap"].includes(k)).indexOf(key));
  return { badge: index < 26 ? String.fromCharCode(65 + index) : String(index + 1), color: speakerColors[index % speakerColors.length] };
}
export function transcriptGroups(rows: MidformRow[]) {
  const groups: { id: string; excluded: boolean; rows: MidformRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (!row.keep && last?.excluded) last.rows.push(row);
    else groups.push({ id: row.id, excluded: !row.keep, rows: [row] });
  }
  return groups;
}
