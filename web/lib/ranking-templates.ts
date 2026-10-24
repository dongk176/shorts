import manifest from "../../worker/shorts_worker/assets/ranking_templates.json";
import { z } from "zod";

export const rankingDesign = manifest;
export const rankingStyleSchema = z
  .object({
    template: z.enum(["classic", "impact", "mint", "berry"]),
    font: z.enum([
      "pretendard",
      "suit",
      "nanum-square-neo",
      "sandbox-aggro",
      "jalnan-2",
      "godo",
      "paperlogy",
      "blackhan",
      "dohyeon",
      "jua",
    ]),
    palette: z.enum(["gold", "red", "mint", "violet"]),
    position: z.enum(["left", "right"]),
    titleColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    subtitleColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();
export type RankingStyle = z.infer<typeof rankingStyleSchema>;
export function rankingPreset(
  template: RankingStyle["template"],
): RankingStyle {
  const preset = rankingDesign.templates[template];
  const colors =
    rankingDesign.palettes[
      preset.palette as keyof typeof rankingDesign.palettes
    ];
  return rankingStyleSchema.parse({
    template,
    font: preset.font,
    palette: preset.palette,
    position: preset.position,
    titleColor: colors.title,
    subtitleColor: colors.subtitle,
    accentColor: colors.accent,
  });
}
export const defaultRankingStyle = rankingPreset("classic");

export function rankingColors(style: RankingStyle) {
  const base = rankingDesign.palettes[style.palette];
  return {
    title: style.titleColor ?? base.title,
    subtitle: style.subtitleColor ?? base.subtitle,
    accent: style.accentColor ?? base.accent,
  };
}
