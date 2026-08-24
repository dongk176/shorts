function linearChannel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastingTitleTextColor(background: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return "#FFFFFF";
  const value = Number.parseInt(match[1], 16);
  const luminance = (
    0.2126 * linearChannel((value >> 16) & 0xff)
    + 0.7152 * linearChannel((value >> 8) & 0xff)
    + 0.0722 * linearChannel(value & 0xff)
  );
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#FFFFFF";
}
