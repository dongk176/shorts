import {
  templatePresetColorOptions,
  type TemplatePresetColor,
} from "@/lib/template-config";

const compactBrandColors = [
  "#FF4D4F",
  "#FF715E",
  "#FFD84D",
  "#35E6E3",
  "#3B82F6",
] as const;

const compactColorOptions = compactBrandColors.map(
  (color) => templatePresetColorOptions.find((option) => option.color === color)!,
);

export function compactBrandColorOptions(value: TemplatePresetColor) {
  const selected = templatePresetColorOptions.find((option) => option.color === value);
  const selectedCompactIndex = compactColorOptions.findIndex(
    (option) => option.color === value,
  );
  if (selectedCompactIndex >= 0) {
    return selectedCompactIndex < 4
      ? compactColorOptions
      : [
          compactColorOptions[selectedCompactIndex],
          ...compactColorOptions.filter((option) => option.color !== value),
        ];
  }
  return selected
    ? [selected, ...compactColorOptions.slice(0, 4)]
    : compactColorOptions;
}
