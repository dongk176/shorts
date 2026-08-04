export function homeAnalysisHeaderOffset({
  isDesktop,
  headerHeight,
}: {
  isDesktop: boolean;
  headerHeight: number;
}) {
  return isDesktop ? 0 : Math.max(0, headerHeight);
}
