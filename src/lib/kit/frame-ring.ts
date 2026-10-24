/**
 * Épaisseur PLEINE du cadre du kit, côté par côté (lot 79).
 *
 * Le cadre est un 9-slice : la découpe (`slice`, 48 px de la case de 300) dit jusqu'où va chaque côté, pas où le dessin s'arrête. Un cadre
 * festonné dont la bande pleine ne fait que 20 px sur un côté et 36 sur un autre laissait, entre le bord intérieur du dessin et la photo, une
 * bande de transparent (la découpe moins l'épaisseur pleine) où l'on voyait le fond du site ; et comme l'écart changeait d'un côté à l'autre,
 * le cadre semblait décalé. On mesure donc, pour chaque côté, où s'arrête le dessin (le bord intérieur) : le cadre est posé contre la photo à
 * cette profondeur, le reste de la découpe (transparent) passe sous la photo.
 *
 * La mesure se fait sur le fichier du cadre (jamais stockée avec le thème : `withFrameRing` la calcule à la lecture, une fois par fichier).
 */
import sharp from "sharp";

import { getStorage } from "@/lib/storage";
import type { Theme } from "@/themes/schema";

import { measureRing, type Slice } from "./frame-measure";

const cache = new Map<string, Promise<[number, number, number, number] | null>>();

async function ringOf(url: string, slice: Slice): Promise<[number, number, number, number] | null> {
  const key = `${url}|${slice.join(",")}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      try {
        const file = url.startsWith("/media/") ? await getStorage().localPath(url.slice("/media/".length)) : null;
        if (!file) return null;
        const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return measureRing({ width: info.width, height: info.height, data }, slice);
      } catch (e) {
        console.error("[kit] mesure du cadre impossible, découpe entière gardée", e);
        return null;
      }
    })();
    cache.set(key, hit);
    if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}

/** Le thème avec l'épaisseur pleine de son cadre (`assets.kit.frame.ring`) ; inchangé sans cadre, ou si le fichier est illisible. */
export async function withFrameRing(theme: Theme): Promise<Theme> {
  const frame = theme.assets.kit?.frame;
  if (!frame || frame.ring) return theme;
  const url = frame.image.webp;
  if (!url) return theme;
  const ring = await ringOf(url, frame.slice);
  if (!ring) return theme;
  return { ...theme, assets: { ...theme.assets, kit: { ...theme.assets.kit, frame: { ...frame, ring } } } };
}
