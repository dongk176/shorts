import { midformRanges, type MidformDraft, type MidformRow, type MidformSourceScene } from "./midform-local";

export type MidformStory = { id: string; index: number; start: number; end: number; availableStart: number; availableEnd: number };

export function resetMidformSelection(draft: MidformDraft, sourceRows: MidformRow[]): MidformDraft {
  const selected = new Map(sourceRows.map(row => [row.id, row.keep]));
  return { ...draft, sceneSplits: [], rows: draft.rows.map(row => ({ ...row, keep: selected.get(row.id) ?? row.keep })) };
}

/** Silence cuts stay inside one story; they never become separate editor blocks. */
export function midformStories(sourceRows: MidformRow[], sourceDuration: number, sceneSplits: number[] = [], sourceScenes?: MidformSourceScene[]): MidformStory[] {
  const blocks = sourceScenes?.length ? sourceScenes : midformRanges(sourceRows, [], false);
  const originals = blocks.map((block, index) => ({ id: sourceRows.find(row => row.keep && row.start >= block.start - .05 && row.start < block.end)?.id || `scene-${index}`, index, start: block.start, end: block.end,
    availableStart: "availableStart" in block && typeof block.availableStart === "number" ? block.availableStart : index ? (blocks[index - 1].end + block.start) / 2 : 0,
    availableEnd: "availableEnd" in block && typeof block.availableEnd === "number" ? block.availableEnd : index < blocks.length - 1 ? (block.end + blocks[index + 1].start) / 2 : sourceDuration,
  }));
  const cuts = Array.isArray(sceneSplits) ? [...new Set(sceneSplits.filter(Number.isFinite))].sort((a,b) => a-b).slice(0,200) : [];
  return originals.flatMap(story => {
    const inside = cuts.filter(cut => cut > story.availableStart && cut < story.availableEnd);
    const boundaries = [story.availableStart, ...inside, story.availableEnd];
    return boundaries.slice(0,-1).map((start, index) => ({ ...story,
      id: inside.length ? `${story.id}@${start}` : story.id,
      availableStart: start, availableEnd: boundaries[index+1],
      start: Math.max(story.start,start), end: Math.min(story.end,boundaries[index+1]),
    }));
  }).map((story,index) => ({ ...story,index }));
}

export function splitMidformStory(draft: MidformDraft, story: MidformStory, seconds: number): MidformDraft {
  if (!Number.isFinite(seconds) || (draft.sceneSplits?.length || 0) >= 200) return draft;
  const bounds = storyBounds(draft.rows, story);
  const boundaries = storyRows(draft.rows, story).filter(row => row.keep && row.start > bounds.start + .08 && row.start < bounds.end - .08);
  if (!boundaries.length || seconds <= bounds.start + .08 || seconds >= bounds.end - .08) return draft;
  const nearest = boundaries.reduce((best,row) => Math.abs(row.start-seconds)<Math.abs(best.start-seconds) ? row : best);
  if (draft.sceneSplits?.includes(nearest.start)) return draft;
  return { ...draft, sceneSplits: [...(draft.sceneSplits || []),nearest.start].sort((a,b) => a-b) };
}

export function deleteMidformStory(draft: MidformDraft, story: MidformStory): MidformDraft {
  const ids = new Set(storyRows(draft.rows,story).map(row => row.id));
  if (!draft.rows.some(row => row.keep && !ids.has(row.id))) return draft;
  const releasedBoundary = draft.sceneSplits?.includes(story.availableStart) ? story.availableStart : story.availableEnd;
  return { ...draft, sceneSplits: draft.sceneSplits?.filter(cut => cut !== releasedBoundary), rows: draft.rows.map(row => ids.has(row.id) ? { ...row,keep:false } : row) };
}

/** UI splits describe contiguous blocks, not extra render instructions. Content changes still use the existing row selection contract. */
export function midformRenderableDraft(draft: MidformDraft): MidformDraft {
  return { rows:draft.rows,framing:draft.framing,names:draft.names,removeSilence:draft.removeSilence,
    ...(draft.silencePreset ? {silencePreset:draft.silencePreset}:{}), ...(draft.entertainment ? {entertainment:draft.entertainment}:{}) };
}

export function midformCaptionCues(rows: MidformRow[], silences: number[][]) {
  let cursor=0;
  const ranges=midformRanges(rows,silences,true).map(range => {const offset=cursor;cursor+=range.end-range.start;return {...range,offset};});
  return rows.filter(row=>row.keep && row.text.trim()).flatMap(row=>{
    const matches=ranges.filter(range=>row.start<range.end && row.end>range.start);
    const first=matches[0],last=matches.at(-1);
    if(!first||!last)return [];
    return [{id:row.id,text:row.text,speaker:row.speaker,start:first.offset+Math.max(0,row.start-first.start),end:last.offset+Math.min(last.end-last.start,row.end-last.start),sourceStart:Math.max(row.start,first.start)}];
  });
}

export function storyRows(rows: MidformRow[], story: MidformStory) {
  return rows.filter(row => (row.start + row.end) / 2 >= story.availableStart && (row.start + row.end) / 2 < story.availableEnd);
}

export function storyBounds(rows: MidformRow[], story: MidformStory) {
  const kept = storyRows(rows, story).filter(row => row.keep);
  return { start: kept[0]?.start ?? story.start, end: kept.at(-1)?.end ?? story.end };
}

/** Change selection only. Immutable row clocks and IDs remain compatible with the existing renderer. */
export function resizeMidformStory(draft: MidformDraft, story: MidformStory, edge: "start" | "end", seconds: number): MidformDraft {
  const available = storyRows(draft.rows, story);
  if (!available.length || !Number.isFinite(seconds)) return draft;
  const old = storyBounds(draft.rows, story);
  const eligible = available.filter(row => edge === "start" ? row.start < old.end : row.end > old.start);
  if (!eligible.length) return draft;
  const nearest = eligible.reduce((best, row) => Math.abs(row[edge] - seconds) < Math.abs(best[edge] - seconds) ? row : best);
  const start = edge === "start" ? nearest.start : old.start;
  const end = edge === "end" ? nearest.end : old.end;
  const ids = new Set(available.map(row => row.id));
  return { ...draft, rows: draft.rows.map(row => {
    if (!ids.has(row.id)) return row;
    const inside = row.end > start && row.start < end;
    const added = row.end <= old.start || row.start >= old.end;
    return { ...row, keep: inside && (row.keep || added) };
  }) };
}
