/** Conservative full-width, solid-background detection; never changes zoom/pan. */
export type RankingAnalysisFrame = { width: number; height: number; data: Uint8ClampedArray };
export type RankingDetectedEdges = { top: number; bottom: number };
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const distance = (a: number[], b: number[]) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
const pixel = (frame: RankingAnalysisFrame, x: number, y: number) => {
  const i = (y * frame.width + x) * 4;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
};

export function detectRankingBackground(frames: RankingAnalysisFrame[]): RankingDetectedEdges | null {
  if (frames.length < 4) return null;
  const { width, height } = frames[0];
  if (width < 32 || height < 32 || frames.some(frame => frame.width !== width || frame.height !== height || frame.data.length !== width * height * 4)) return null;
  // Ignore blank/fade frames instead of allowing them to vote for a full-frame cut.
  const informative = frames.filter(frame => {
    const values: number[] = [];
    for (let y = Math.floor(height * .25); y < height * .75; y += 3)
      for (let x = Math.floor(width * .15); x < width * .85; x += 3) values.push(...pixel(frame, x, y));
    const sorted = values.sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * .9)] - sorted[Math.floor(sorted.length * .1)] > 35;
  });
  if (informative.length < 4) return null;

  function edge(bottom: boolean) {
    const background = informative.map(frame => {
      const pixels: number[][] = [];
      for (let y = 0; y < 3; y++) for (let x = 2; x < width - 2; x += 3)
        pixels.push(pixel(frame, x, bottom ? height - 1 - y : y));
      const color = [0, 1, 2].map(c => median(pixels.map(p => p[c])));
      return { frame, color, solid: pixels.filter(p => distance(p, color) <= 26).length / pixels.length >= .9 };
    });
    if (background.filter(item => item.solid).length < Math.ceil(informative.length * .8)) return 0;
    const ratios = Array.from({ length: Math.ceil(height * .6) }, (_, offset) => {
      const rows = background.map(({ frame, color }) => {
        let matching = 0, samples = 0;
        for (let x = 1; x < width - 1; x += 2) {
          samples++; if (distance(pixel(frame, x, bottom ? height - 1 - offset : offset), color) <= 30) matching++;
        }
        return matching / samples;
      }).sort((a, b) => a - b);
      // At least 75% of sampled scenes must agree on the background.
      return rows[Math.floor(rows.length * .25)];
    });
    const block = Math.max(2, Math.round(height * .008));
    const gapLimit = Math.ceil(height * .055);
    let gapStart = -1, boundary = 0;
    for (let y = 0; y + block <= ratios.length; y += block) {
      const mean = ratios.slice(y, y + block).reduce((a, b) => a + b, 0) / block;
      if (mean >= .76) { gapStart = -1; boundary = y + block; }
      else {
        if (gapStart < 0) gapStart = y;
        if (y + block - gapStart > gapLimit) { boundary = gapStart; break; }
      }
    }
    if (boundary < height * .025 || boundary > height * .55) return 0;
    const average = ratios.slice(0, boundary).reduce((a, b) => a + b, 0) / boundary;
    if (average < .73) return 0;
    const after = ratios.slice(boundary + block, Math.min(ratios.length, boundary + Math.ceil(height * .08)));
    if (!after.length || after.reduce((a, b) => a + b, 0) / after.length > .65) return 0;
    // A persistent, broad horizontal boundary is required, not just a dark scene.
    let best = 0, bestRow = boundary;
    for (let offset = Math.max(2, boundary - block * 2); offset <= Math.min(ratios.length - 2, boundary + block * 2); offset++) {
      const scores = informative.map(frame => {
        let sum = 0, n = 0;
        for (let x = 2; x < width - 2; x += 2) {
          const y = bottom ? height - offset : offset;
          sum += distance(pixel(frame, x, y - 1), pixel(frame, x, y)); n++;
        }
        return sum / n;
      }).sort((a, b) => a - b);
      const score = scores[Math.floor(scores.length * .25)];
      if (score > best) { best = score; bestRow = offset; }
    }
    return best >= 20 ? bestRow / height : 0;
  }
  const top = edge(false), bottom = edge(true);
  if ((!top && !bottom) || top + bottom > .7) return null;
  return { top, bottom };
}

/** Samples a separate decoder so the visible player's time/play state is untouched. */
export async function analyzeRankingBackground(url: string, start: number, end: number, signal: AbortSignal): Promise<RankingDetectedEdges | null> {
  if (!url || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("선택 구간을 먼저 확인해 주세요.");
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("이 브라우저에서는 자동 찾기를 사용할 수 없어요.");
  const deadline = Date.now() + 12_000;
  const wait = (event: "loadedmetadata" | "seeked" | "loadeddata") => new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener("error", failure); signal.removeEventListener("abort", abort); };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error("영상을 분석하지 못했어요. 직접 조절하거나 다시 시도해 주세요.")); };
    const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(failure, Math.max(1, Math.min(4000, deadline - Date.now())));
    video.addEventListener(event, success, { once: true }); video.addEventListener("error", failure, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    video.muted = true; video.playsInline = true; video.preload = "auto"; video.crossOrigin = "anonymous";
    const metadata = wait("loadedmetadata"); video.src = url; video.load(); await metadata;
    const from = Math.min(start, Math.max(0, video.duration - .1));
    const to = Math.min(end, video.duration - .02);
    if (!Number.isFinite(to) || to <= from || !video.videoWidth || !video.videoHeight) throw new Error("영상의 선택 구간을 확인해 주세요.");
    const scale = Math.min(1, 360 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(32, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(32, Math.round(video.videoHeight * scale));
    const frames: RankingAnalysisFrame[] = [];
    for (let i = 0; i < 7; i++) {
      signal.throwIfAborted();
      const time = from + (to - from) * (.08 + i * .14);
      if (Math.abs(video.currentTime - time) > .001) {
        const seeked = wait("seeked"); video.currentTime = time; await seeked;
      } else if (video.readyState < 2) await wait("loadeddata");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(context.getImageData(0, 0, canvas.width, canvas.height));
    }
    signal.throwIfAborted();
    return detectRankingBackground(frames);
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") throw new Error("이 영상은 자동 분석이 제한돼요. 손잡이로 직접 조절해 주세요.");
    throw error;
  } finally {
    video.pause(); video.removeAttribute("src"); video.load(); canvas.width = canvas.height = 0;
  }
}
