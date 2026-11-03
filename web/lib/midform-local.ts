// The prototype's single-user service is never available in a deployed app.
export function midformLocalEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "development" && env.EASYCUT_MIDFORM_LOCAL === "1" && !env.VERCEL;
}

export function midformRequestAllowed(request: Request) {
  const url = new URL(request.url);
  // Next dev normalizes the internal URL to localhost; the browser Host must still be loopback.
  const authority = `127.0.0.1:${url.port}`;
  return ["127.0.0.1", "localhost"].includes(url.hostname)
    && request.headers.get("host") === authority
    && request.headers.get("sec-fetch-site") !== "cross-site"
    && (request.method === "GET" || request.headers.get("origin") === `http://${authority}`);
}

export type MidformRow = { id: string; start: number; end: number; text: string; speaker: string; keep: boolean };
export type SilencePreset = "aggressive" | "medium" | "relaxed";
export type MidformDraft = { rows: MidformRow[]; framing: Record<string, string>; names: Record<string, string>; removeSilence: boolean; silencePreset?: SilencePreset; entertainment?: import("./midform-captions").EntertainmentCaptions };
export function midformRanges(rows: MidformRow[], silences: number[][], removeSilence: boolean) {
  const blocks: { start: number; end: number; row: MidformRow }[] = [];
  let interrupted = true;
  for (const row of rows) {
    if (!row.keep) { interrupted = true; continue; }
    const previous = blocks.at(-1);
    if (previous && !interrupted && row.start - previous.end <= .5) previous.end = row.end;
    else blocks.push({ start: row.start, end: row.end, row });
    interrupted = false;
  }
  return blocks.flatMap(block => {
    let pieces = [[block.start, block.end]];
    if (removeSilence) for (const [left, right] of silences) {
      pieces = pieces.flatMap(([start, end]) => right <= start || left >= end ? [[start, end]]
        : [[start, Math.min(left, end)], [Math.max(right, start), end]].filter(([a, b]) => b - a >= .08));
    }
    return pieces.map(([start, end]) => ({ start, end, row: block.row }));
  });
}
