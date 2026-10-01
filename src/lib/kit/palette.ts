/**
 * Palette suggérée depuis les plans du hero (prototype, phase 6b) :
 * quantification MMCQ et générateur par défaut de node-vibrant (paquets
 * @vibrant/* seuls, sans le chargeur d'images jimp : les pixels viennent de
 * sharp), puis rôles proposés pour les tokens, contraste vérifié.
 */
import { DefaultGenerator } from "@vibrant/generator-default";
import { MMCQ } from "@vibrant/quantizer-mmcq";
import sharp from "sharp";

import { ratio } from "@/themes/contrast";

import type { Rgba } from "./formats";

export type PaletteSuggestion = {
  swatches: Record<string, { hex: string; population: number } | null>;
  /** Rôles proposés (tokens de couleur du thème). */
  roles: { bg?: string; bgDeep?: string; ink?: string; inkSoft?: string; primary?: string; secondary?: string; tertiary?: string };
  /** Contraste encre / fond proposé (AA : 4,5). */
  inkOnBg?: number;
};

/** Échantillon des pixels opaques de chaque plan (réduit à 160 px de large). */
async function sample(img: Rgba): Promise<Buffer> {
  const { data } = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(160, 160, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const kept: number[] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 200) kept.push(data[i], data[i + 1], data[i + 2], 255);
  return Buffer.from(kept);
}

export async function suggestPalette(plans: Rgba[]): Promise<PaletteSuggestion | null> {
  if (!plans.length) return null;
  const pixels = Buffer.concat(await Promise.all(plans.map(sample)));
  if (pixels.length < 64) return null;
  const swatches = await MMCQ(pixels, { colorCount: 64 });
  const palette = await DefaultGenerator(swatches);
  const pick = (...names: string[]) => names.map((n) => palette[n]).find(Boolean)?.hex;
  const roles: PaletteSuggestion["roles"] = {
    bg: pick("LightMuted", "LightVibrant"),
    bgDeep: pick("LightVibrant", "LightMuted"),
    ink: pick("DarkMuted", "DarkVibrant"),
    inkSoft: pick("Muted", "DarkMuted"),
    primary: pick("DarkVibrant", "Vibrant"),
    secondary: pick("Vibrant", "Muted"),
    tertiary: pick("Muted", "LightVibrant"),
  };
  const out: PaletteSuggestion["swatches"] = {};
  for (const [name, s] of Object.entries(palette)) out[name] = s ? { hex: s.hex, population: s.population } : null;
  return { swatches: out, roles, inkOnBg: roles.ink && roles.bg ? Math.round(ratio(roles.ink, roles.bg) * 100) / 100 : undefined };
}
