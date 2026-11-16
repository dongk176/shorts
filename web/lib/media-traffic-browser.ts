export function browserTrafficBytes(entry: {
  responseStart: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}) {
  if (entry.responseStart <= 0 || entry.decodedBodySize <= 0) return null;
  return entry.transferSize <= 300 ? 0 : entry.encodedBodySize;
}
