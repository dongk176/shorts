// Inspect bounded ISO-BMFF metadata; never load or decode the entire video.
type Box = { type: string; data: number; end: number };
const invalid = () => new Error("Unsupported finished MP4");
function boxes(bytes: Buffer, start = 0, end = bytes.length): Box[] {
  const result: Box[] = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end || result.length > 10000) throw invalid();
    let size = bytes.readUInt32BE(offset), header = 8;
    if (size === 1) { if (offset + 16 > end) throw invalid(); size = Number(bytes.readBigUInt64BE(offset + 8)); header = 16; }
    if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > end) throw invalid();
    result.push({ type: bytes.toString("ascii", offset + 4, offset + 8), data: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
function child(bytes: Buffer, parent: Box, type: string) {
  const box = boxes(bytes, parent.data, parent.end).find(value => value.type === type);
  if (!box) throw invalid();
  return box;
}
export function inspectMoov(bytes: Buffer) {
  const moov = boxes(bytes).find(box => box.type === "moov");
  if (!moov) throw invalid();
  const mvhd = child(bytes, moov, "mvhd");
  const movieVersion = bytes[mvhd.data];
  if (movieVersion > 1 || mvhd.end - mvhd.data < (movieVersion === 1 ? 32 : 20)) throw invalid();
  const movieTimescale = bytes.readUInt32BE(mvhd.data + (movieVersion === 1 ? 20 : 12));
  for (const track of boxes(bytes, moov.data, moov.end).filter(box => box.type === "trak")) {
    const mdia = child(bytes, track, "mdia"), handler = child(bytes, mdia, "hdlr");
    if (handler.end < handler.data + 12 || bytes.toString("ascii", handler.data + 8, handler.data + 12) !== "vide") continue;
    const tkhd = child(bytes, track, "tkhd"), mdhd = child(bytes, mdia, "mdhd");
    if (tkhd.end - tkhd.data < 84 || mdhd.end - mdhd.data < 24) throw invalid();
    const width = bytes.readUInt32BE(tkhd.end - 8) / 65536, height = bytes.readUInt32BE(tkhd.end - 4) / 65536;
    const version = bytes[mdhd.data];
    if (version > 1 || version === 1 && mdhd.end - mdhd.data < 36) throw invalid();
    const timescale = bytes.readUInt32BE(mdhd.data + (version === 1 ? 20 : 12));
    // tkhd is the presented track duration in movie timescale. mdhd includes
    // decoding preroll (e.g. B-frame edit offsets), not just the visible video.
    const trackVersion = bytes[tkhd.data];
    if (trackVersion > 1 || tkhd.end - tkhd.data < (trackVersion === 1 ? 96 : 84)) throw invalid();
    const ticks = trackVersion === 1 ? Number(bytes.readBigUInt64BE(tkhd.data + 28)) : bytes.readUInt32BE(tkhd.data + 20);
    const duration = ticks / movieTimescale;
    const stbl = child(bytes, child(bytes, mdia, "minf"), "stbl"), stsd = child(bytes, stbl, "stsd"), stts = child(bytes, stbl, "stts");
    if (stsd.end < stsd.data + 16 || stts.end < stts.data + 8) throw invalid();
    const codec = bytes.toString("ascii", stsd.data + 12, stsd.data + 16);
    const count = bytes.readUInt32BE(stts.data + 4);
    if (count < 1 || count > 100000 || stts.data + 8 + count * 8 > stts.end) throw invalid();
    let samples = 0, totalTicks = 0;
    for (let i = 0; i < count; i++) {
      const n = bytes.readUInt32BE(stts.data + 8 + i * 8), delta = bytes.readUInt32BE(stts.data + 12 + i * 8);
      samples += n; totalTicks += n * delta;
    }
    const fps = samples * timescale / totalTicks;
    if (!Number.isFinite(duration) || duration < 3 || duration > 600 || !["avc1", "avc3", "hvc1", "hev1", "vp09"].includes(codec)
      || width < 360 || height < 360 || width > 4096 || height > 4096 || !Number.isFinite(fps) || fps < 23 || fps > 60) throw invalid();
    return { duration, width, height, fps, codec };
  }
  throw invalid();
}

export async function probeMp4(size: number, range: (start: number, end: number) => Promise<Buffer>) {
  for (let offset = 0, count = 0; offset + 8 <= size && count < 64; count++) {
    const header = await range(offset, Math.min(size - 1, offset + 15));
    if (header.length < 8) throw invalid();
    let boxSize = header.readUInt32BE(0);
    if (boxSize === 1) { if (header.length < 16) throw invalid(); boxSize = Number(header.readBigUInt64BE(8)); }
    if (boxSize === 0) boxSize = size - offset;
    if (!Number.isSafeInteger(boxSize) || boxSize < 8 || offset + boxSize > size) throw invalid();
    if (header.toString("ascii", 4, 8) === "moov") {
      if (boxSize > 8 * 1024 * 1024) throw invalid();
      return inspectMoov(await range(offset, offset + boxSize - 1));
    }
    offset += boxSize;
  }
  throw invalid();
}
