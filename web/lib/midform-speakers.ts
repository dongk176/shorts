import type { MidformDraft, MidformRow } from "./midform-local";

export const speakerColors = ["#69d6b0", "#83bfff", "#e7a0cd", "#efc570", "#baa0f4", "#f29e83"];
export function speakerKeys(draft: MidformDraft) {
  return [...new Set([...Object.keys(draft.names), ...draft.rows.map(row => row.speaker)])];
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
