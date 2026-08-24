export function usageMinutes(seconds: number) {
  return Math.max(0, Math.floor(seconds / 60)).toLocaleString("ko-KR");
}
