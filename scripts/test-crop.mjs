#!/usr/bin/env node
/**
 * Lot 17d — recadrage libre (inclus dans npm test) :
 *  1. schéma : rectangle borné, dans l'image, refusé sinon (y compris dans `look`) ;
 *  2. clés : rectangle en dix-millièmes, URL `crop/…` analysée strictement, largeurs d'une liste fermée ;
 *  3. signature : seule une URL écrite par le serveur est acceptée ;
 *  4. choix du rectangle d'un emplacement (libre, ancien cadrage converti, décor dans une case étroite) ;
 *  5. cache disque (sharp réel) : pixels extraits de l'ORIGINAL, orientation EXIF, une génération par
 *     variante, largeur hors liste refusée, file d'attente bornée, au plus MAX_RECTS par média, purge.
 * Usage : node --import tsx scripts/test-crop.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const DIR = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-crop-"));
process.env.DATA_DIR = DIR;
process.env.BETTER_AUTH_SECRET = "test-secret-0123456789abcdef-0123456789abcdef";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const crop = await import("../src/lib/images/crop.ts");
  const { LookSchema, lookAttributes, cropStyle } = await import("../src/lib/look.ts");
  const { resolveCrop } = await import("../src/lib/images/crop-view.ts");

  /* ---- 1. schéma ------------------------------------------------------------------ */
  const good = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
  ok("rectangle valide accepté", crop.RectSchema.safeParse(good).success);
  ok("rectangle plein accepté", crop.RectSchema.safeParse({ x: 0, y: 0, w: 1, h: 1 }).success);
  for (const [label, bad] of [
    ["x négatif", { ...good, x: -0.1 }],
    ["largeur nulle", { ...good, w: 0 }],
    ["largeur sous 1 %", { ...good, w: 0.005 }],
    ["déborde à droite", { ...good, x: 0.6 }],
    ["déborde en bas", { ...good, y: 0.7 }],
    ["clé en trop", { ...good, extra: 1 }],
    ["NaN", { ...good, w: Number.NaN }],
    ["texte", { ...good, h: "0.5" }],
  ]) ok(`rectangle refusé : ${label}`, !crop.RectSchema.safeParse(bad).success);
  const withRect = { crop: { mediaId: { x: 50, y: 50, zoom: 1, rect: good } } };
  ok("look.crop accepte un rectangle", LookSchema.safeParse(withRect).success);
  ok("look.tileCrop accepte un rectangle", LookSchema.safeParse({ tileCrop: { characters: { x: 50, y: 50, zoom: 1, rect: good } } }).success);
  ok("look.crop refuse un rectangle hors de l'image", !LookSchema.safeParse({ crop: { mediaId: { x: 50, y: 50, zoom: 1, rect: { ...good, w: 0.95 } } } }).success);
  ok("l'ancien cadrage (sans rectangle) reste valide", LookSchema.safeParse({ crop: { mediaId: { x: 30, y: 60, zoom: 1.5 } } }).success);
  const rectLook = LookSchema.parse(withRect);
  ok("un recadrage libre ne pose ni data-crop ni variables CSS de zoom", lookAttributes(rectLook) === null && cropStyle(rectLook) === undefined);
  ok("un ancien cadrage pose toujours data-crop", "data-crop" in (lookAttributes(LookSchema.parse({ crop: { mediaId: { x: 30, y: 60, zoom: 1.5 } } })) ?? {}));

  /* ---- 2. clés --------------------------------------------------------------------- */
  const u = crop.toUnits({ x: 0.123456, y: 0.2, w: 0.5, h: 0.4 });
  ok("arrondi au dix-millième", u.x === 1235 && u.y === 2000 && u.w === 5000 && u.h === 4000, JSON.stringify(u));
  ok("clé du rectangle et retour", crop.rectKey(u) === "x1235y2000w5000h4000" && JSON.stringify(crop.parseRectKey("x1235y2000w5000h4000")) === JSON.stringify(u));
  ok("toUnits garde le rectangle dans l'image", (() => { const v = crop.toUnits({ x: 0.9, y: 0, w: 0.5, h: 1 }); return v.x + v.w <= 10000; })());
  for (const bad of ["x0y0w50h50", "x0y0w10001h5000", "x6000y0w5000h5000", "x0y0w5000h5000x", "x123456y0w5000h5000", "x0y0w0h5000", "../x0y0w5000h5000", ""])
    ok(`clé de rectangle refusée : « ${bad} »`, crop.parseRectKey(bad) === null);
  const sig = "0123456789abcdef0123";
  ok("URL de recadrage valide analysée", crop.parseCropKey(`crop/12/x0y0w10000h5000-${sig}/960.avif`)?.width === 960);
  for (const bad of [
    `crop/0/x0y0w10000h5000-${sig}/960.avif`,
    `crop/012/x0y0w10000h5000-${sig}/960.avif`,
    `crop/12/x0y0w10000h5000-${sig.slice(1)}/960.avif`,
    `crop/12/x0y0w10000h5000-${sig.toUpperCase()}/960.avif`,
    `crop/12/x0y0w10000h5000-${sig}/96000.avif`,
    `crop/12/x0y0w10000h5000-${sig}/960.gif`,
    `crop/12/x0y0w10000h5000-${sig}/960.avif/extra`,
    `crop/12/../x0y0w10000h5000-${sig}/960.avif`,
    `crop/1234567890/x0y0w10000h5000-${sig}/960.avif`,
    `crop/12/x0y0w50h5000-${sig}/960.avif`,
  ])
    ok(`URL de recadrage refusée : ${bad.slice(0, 48)}…`, crop.parseCropKey(bad) === null);
  const w1 = crop.cropWidths(1200, 800);
  ok("largeurs : sous la taille réelle, puis la taille réelle", w1.join() === "480,960,1200", w1.join());
  const w2 = crop.cropWidths(20000, 4000);
  ok("largeurs : liste fermée au plus 4800 px", w2.join() === "480,960,1600,2400,3600,4800", w2.join());
  const w3 = crop.cropWidths(6000, 6000);
  ok("largeurs : sortie plafonnée en pixels (carré 6000 → pas de 4800)", Math.max(...w3) * Math.max(...w3) <= crop.CROP_MAX_PIXELS && !w3.includes(4800), w3.join());
  ok("largeurs : petit recadrage (300 px) = sa taille", crop.cropWidths(300, 200).join() === "300", crop.cropWidths(300, 200).join());
  const src = crop.cropSources({ id: 7, width: 20000, height: 4000 }, { x: 0.5, y: 0, w: 0.25, h: 1 }, () => sig, (k) => `/media/${k}`, "#123456");
  ok("sources recadrées : 5000 × 4000 px, srcset AVIF (5 largeurs sous le plafond de pixels) et WebP", src.width === 5000 && src.height === 4000 && src.sources.avif.split(",").length === 5 && src.sources.webp.split(",").length === 5 && /\/media\/crop\/7\/x5000y0w2500h10000-0123456789abcdef0123\/480\.avif 480w/.test(src.sources.avif), JSON.stringify(src.sources.avif));
  ok("sources recadrées : la plus grande variante = la dernière largeur, au rapport exact", src.sources.largest.w === 3600 && src.sources.largest.h === 2880, JSON.stringify(src.sources.largest));

  /* ---- 3. signature -------------------------------------------------------------- */
  const cache = await import("../src/lib/images/crop-cache.ts");
  const key = crop.rectKey(u);
  const s = cache.signCrop(7, key);
  ok("signature de 20 hexadécimaux, vérifiée", /^[0-9a-f]{20}$/.test(s) && cache.verifyCrop(7, key, s));
  ok("signature : un autre média, un autre rectangle ou une signature modifiée sont refusés", !cache.verifyCrop(8, key, s) && !cache.verifyCrop(7, "x0y0w10000h10000", s) && !cache.verifyCrop(7, key, `${s.slice(0, 19)}${s[19] === "0" ? "1" : "0"}`) && !cache.verifyCrop(7, key, s.slice(1)));

  /* ---- 4. choix du rectangle ------------------------------------------------------ */
  ok("recadrage libre : son rectangle, le cadre le suit", (() => { const r = resolveCrop({ x: 50, y: 50, zoom: 1, rect: good }, 5, 0.8, true); return r?.free === true && r.rect.w === 0.5; })());
  ok("recadrage libre couvrant tout : rien à faire", resolveCrop({ x: 50, y: 50, zoom: 1, rect: { x: 0, y: 0, w: 1, h: 1 } }, 5, 0.8, true) === null);
  const pano = resolveCrop({ x: 50, y: 50, zoom: 1.5 }, 5, 0.8, true);
  ok("ancien cadrage (zoom 150 %) d'un panorama 5:1 dans une case 4:5 : fenêtre = 1/6,25/1,5 de la largeur, hauteur 1/1,5", pano?.free === false && Math.abs(pano.rect.w - 0.16 / 1.5) < 1e-9 && Math.abs(pano.rect.h - 1 / 1.5) < 1e-9, JSON.stringify(pano));
  ok("décor 5:1 sans cadrage dans une case 4:5 : fenêtre centrée", (() => { const r = resolveCrop(undefined, 5, 0.8, true); return Boolean(r) && Math.abs(r.rect.x + r.rect.w / 2 - 0.5) < 1e-9 && r.rect.h === 1; })());
  ok("image au format du cadre ou peu rognée : servie entière", resolveCrop(undefined, 1.5, 1.6, true) === null && resolveCrop(undefined, 1.4, 1, true) === null && resolveCrop(undefined, 5, null, true) === null);
  ok("« image entière » (contain) : aucune fenêtre", resolveCrop(undefined, 5, 0.8, false) === null);

  /* ---- 5. cache disque -------------------------------------------------------------- */
  const media = path.join(DIR, "media", "originals");
  mkdirSync(media, { recursive: true });
  // 3000 × 1000 : moitié gauche rouge, moitié droite bleue.
  const half = async (w, h, left, right) =>
    sharp({ create: { width: w, height: h, channels: 3, background: right } })
      .composite([{ input: await sharp({ create: { width: w / 2, height: h, channels: 3, background: left } }).png().toBuffer(), left: 0, top: 0 }])
      .png()
      .toBuffer();
  writeFileSync(path.join(media, "a.png"), await half(3000, 1000, { r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }));
  const m = { id: 1, key: "originals/a.png", width: 3000, height: 1000 };
  const R = crop.toUnits({ x: 0.5, y: 0, w: 0.5, h: 1 });
  const first = await cache.ensureCrop(m, R, 960, "webp");
  const meta = await sharp(first.file).metadata();
  const px = await sharp(first.file).resize(1, 1, { kernel: "nearest" }).raw().toBuffer();
  ok("variante recadrée : 960 × 640 px (rapport exact du rectangle 1500 × 1000)", meta.width === 960 && meta.height === 640 && meta.format === "webp", `${meta.width}x${meta.height}`);
  ok("variante recadrée : pixels de la moitié DROITE de l'original (bleu)", px[2] > 200 && px[0] < 40, [...px].join());
  const t0 = statSync(first.file).mtimeMs;
  await sleep(20);
  const again = await cache.ensureCrop(m, R, 960, "webp");
  ok("deuxième demande : servie du disque, sans régénération", again.file === first.file && statSync(again.file).mtimeMs === t0);
  const avif = await cache.ensureCrop(m, R, 480, "avif");
  ok("AVIF généré aussi", (await sharp(avif.file).metadata()).format === "heif");
  let rejected = null;
  try {
    await cache.ensureCrop(m, R, 1234, "webp");
  } catch (error) {
    rejected = error;
  }
  ok("largeur hors de la liste : refusée (CropRejected), rien écrit", rejected instanceof cache.CropRejected && !readdirSync(path.join(DIR, "cache", "crops", "1", crop.rectKey(R))).includes("1234.webp"));
  const same = await Promise.all([cache.ensureCrop(m, R, 480, "webp"), cache.ensureCrop(m, R, 480, "webp")]);
  ok("deux demandes simultanées de la même variante : un seul fichier", same[0].file === same[1].file);

  // Orientation EXIF 6 (rotation 90° horaire à l'affichage) : l'image vue fait 200 × 400, la moitié rouge (gauche du fichier) est en HAUT.
  writeFileSync(path.join(media, "o.jpg"), await sharp(await half(400, 200, { r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 })).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer());
  const mo = { id: 2, key: "originals/o.jpg", width: 200, height: 400 };
  const top = await cache.ensureCrop(mo, crop.toUnits({ x: 0, y: 0, w: 1, h: 0.5 }), 200, "webp");
  const topMeta = await sharp(top.file).metadata();
  const topPx = await sharp(top.file).resize(1, 1, { kernel: "nearest" }).raw().toBuffer();
  ok("EXIF 6 : le rectangle est celui de l'image vue (moitié haute = 200 × 200, rouge)", topMeta.width === 200 && topMeta.height === 200 && topPx[0] > 200 && topPx[2] < 60, `${topMeta.width}x${topMeta.height} ${[...topPx].join()}`);

  // Les 8 orientations EXIF : la scène VUE (600 × 300) porte un « personnage » (carré magenta) et quatre quadrants de couleurs ;
  // le fichier est fabriqué par la transformation inverse, puis recadré. Le rectangle est toujours celui de l'image vue.
  const scene = await (async () => {
    const quad = async (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
    return sharp({ create: { width: 600, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .composite([
        { input: await quad(300, 150, { r: 0, g: 200, b: 0 }), left: 300, top: 0 },
        { input: await quad(300, 150, { r: 0, g: 0, b: 255 }), left: 0, top: 150 },
        { input: await quad(300, 150, { r: 250, g: 250, b: 0 }), left: 300, top: 150 },
        { input: await quad(60, 60, { r: 255, g: 0, b: 255 }), left: 390, top: 40 }, // le personnage, en haut à droite
      ])
      .removeAlpha()
      .png()
      .toBuffer();
  })();
  const rawOf = async (buf) => {
    const { data, info } = await buf.raw().toBuffer({ resolveWithObject: true });
    return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  };
  // Inverse de l'orientation EXIF o : fichier (non tourné) dont l'affichage corrigé redonne la scène.
  const inverse = async (o) => {
    const base = sharp(scene);
    switch (o) {
      case 1: return base;
      case 2: return base.flop();
      case 3: return base.rotate(180);
      case 4: return base.flip();
      case 5: return rawOf((await rawOf(base.flop())).rotate(270));
      case 6: return base.rotate(270);
      case 7: return rawOf((await rawOf(base.flop())).rotate(90));
      default: return base.rotate(90);
    }
  };
  const frame = { x: 0.55, y: 0.05, w: 0.4, h: 0.45 }; // contient le personnage (x 390..450 de 600 = 0,65..0,75 ; y 40..100 de 300)
  let orientOk = 0;
  const detail = [];
  for (let o = 1; o <= 8; o++) {
    const file = `eo${o}.jpg`;
    writeFileSync(path.join(media, file), await (await inverse(o)).withMetadata({ orientation: o }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer());
    const viewed = await sharp(path.join(media, file)).rotate().raw().toBuffer({ resolveWithObject: true });
    const generator = viewed.info.width === 600 && viewed.info.height === 300 && viewed.data[0] > 230 && viewed.data[1] < 30 && viewed.data[2] < 30;
    const mo8 = { id: 20 + o, key: `originals/${file}`, width: 600, height: 300 };
    const out = await cache.ensureCrop(mo8, crop.toUnits(frame), 240, "webp");
    const { data, info } = await sharp(out.file).raw().toBuffer({ resolveWithObject: true });
    const at = (fx, fy) => {
      const i = (Math.round(fy * (info.height - 1)) * info.width + Math.round(fx * (info.width - 1))) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Cadre : x 330..570, y 15..150 de la scène. Personnage (390..450, 40..100) : centre (420, 70) => fx 0,375 ; fy 0,41.
    const marker = at(0.375, 0.41);
    const bg = at(0.8, 0.9); // x 522, y 135 : quadrant haut-droit (vert) de la scène
    const good = info.width === 240 && info.height === 135 && marker[0] > 220 && marker[1] < 60 && marker[2] > 220 && bg[1] > 150 && bg[0] < 60 && generator;
    if (good) orientOk++;
    else detail.push(`o${o}: ${info.width}x${info.height} marqueur ${marker} fond ${bg} fichier ${generator}`);
  }
  ok("EXIF 1 à 8 : le personnage est dans la découpe, aux bonnes couleurs et à la bonne taille (240 × 135, rectangle de l'image vue)", orientOk === 8, detail.join(" | "));

  // Mémoire : un JPEG de 100 Mpx (10000 × 10000) en orientation 6 ne doit pas coûter plus que le même en orientation 1.
  {
    const big = path.join(media, "big1.jpg");
    const { spawnSync } = await import("node:child_process");
    const noise = Buffer.alloc(1000 * 1000 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + (i >> 9)) & 255;
    const tile = await sharp(noise, { raw: { width: 1000, height: 1000, channels: 3 } }).png().toBuffer();
    const bigBuf = await sharp({ create: { width: 10000, height: 10000, channels: 3, background: { r: 40, g: 80, b: 120 } } })
      .composite(Array.from({ length: 10 }, (_, i) => ({ input: tile, left: i * 1000, top: i * 1000 })))
      .withMetadata({ orientation: 1 })
      .jpeg({ quality: 70 })
      .toBuffer();
    writeFileSync(big, bigBuf);
    writeFileSync(path.join(media, "big6.jpg"), await sharp(bigBuf).withMetadata({ orientation: 6 }).jpeg({ quality: 70 }).toBuffer());
    const rss = (key, id) => {
      const r = spawnSync(process.execPath, ["--import", "tsx", new URL("./crop-rss-child.mjs", import.meta.url).pathname, DIR, key, String(id)], { encoding: "utf8", env: { ...process.env, MALLOC_ARENA_MAX: "2", MALLOC_MMAP_THRESHOLD_: "131072", MALLOC_TRIM_THRESHOLD_: "131072" } });
      const m = /MAXRSS (\d+)/.exec(r.stdout);
      return m ? Number(m[1]) : NaN;
    };
    const r1 = rss("originals/big1.jpg", 40);
    const r6 = rss("originals/big6.jpg", 41);
    ok(`JPEG 100 Mpx : recadrage en orientation 6 (${r6} Mo) pas plus gourmand qu'en orientation 1 (${r1} Mo)`, Number.isFinite(r1) && Number.isFinite(r6) && r6 <= r1 * 1.2 + 25, `${r1} / ${r6}`);
    ok(`JPEG 100 Mpx : maxRSS en orientation 6 sous 300 Mo (${r6} Mo)`, r6 < 300);
    rmSync(big, { force: true });
    rmSync(path.join(media, "big6.jpg"), { force: true });
  }

  // File d'attente bornée : plus de demandes que la file n'en tient → les dernières reçoivent CropBusy, les autres aboutissent.
  const many = Array.from({ length: cache.MAX_WAITING + 8 }, (_, i) => crop.toUnits({ x: 0, y: 0, w: 0.2 + i * 0.02, h: 1 }));
  const results = await Promise.allSettled(many.map((r) => cache.ensureCrop({ ...m, id: 3 }, r, 480, "webp")));
  const busy = results.filter((r) => r.status === "rejected" && r.reason instanceof cache.CropBusy).length;
  const done = results.filter((r) => r.status === "fulfilled").length;
  const other = results.filter((r) => r.status === "rejected" && !(r.reason instanceof cache.CropBusy));
  ok(`file pleine : ${busy} demande(s) refusée(s) (CropBusy), ${done} traitée(s), aucune autre erreur`, busy >= 1 && done >= cache.MAX_WAITING && other.length === 0, other.map((o) => String(o.reason)).join("; "));
  for (const end = Date.now() + 20000; Date.now() < end && cache.cropQueueLength() > 0; await sleep(50));
  ok("file vidée ensuite (demandes gardées comprises)", cache.cropQueueLength() === 0);
  // Les demandes refusées ne sont pas perdues : la variante est préparée en fond dès que la file se libère (la nouvelle tentative du visiteur la trouve).
  const refused = results.map((r, i) => (r.status === "rejected" && r.reason instanceof cache.CropBusy ? many[i] : null)).filter(Boolean);
  ok("demandes refusées (503) : variantes préparées en fond, présentes sur disque peu après", refused.length > 0 && (await (async () => {
    for (const end = Date.now() + 20000; Date.now() < end; await sleep(100)) if (refused.every((u) => existsSync(cache.cropFile(3, u, 480, "webp")))) return true;
    return false;
  })()), `${refused.filter((u) => existsSync(cache.cropFile(3, u, 480, "webp"))).length}/${refused.length}`);

  // Au plus MAX_RECTS recadrages par média : le plus ancien part.
  for (let i = 0; i < cache.MAX_RECTS + 4; i++) {
    await cache.ensureCrop({ ...m, id: 4 }, crop.toUnits({ x: 0, y: 0, w: 0.3 + i * 0.01, h: 0.9 }), 480, "webp");
    await sleep(6);
  }
  const dirs = readdirSync(path.join(DIR, "cache", "crops", "4"));
  ok(`au plus ${cache.MAX_RECTS} recadrages gardés par média (${dirs.length}), le plus ancien effacé, le dernier présent`, dirs.length <= cache.MAX_RECTS && !dirs.includes(crop.rectKey(crop.toUnits({ x: 0, y: 0, w: 0.3, h: 0.9 }))) && dirs.includes(crop.rectKey(crop.toUnits({ x: 0, y: 0, w: 0.3 + (cache.MAX_RECTS + 3) * 0.01, h: 0.9 }))));

  await cache.purgeCrops(1);
  let gone = false;
  try {
    statSync(path.join(DIR, "cache", "crops", "1"));
  } catch {
    gone = true;
  }
  ok("purge : le dossier du média disparaît (les autres médias restent)", gone && readdirSync(path.join(DIR, "cache", "crops", "4")).length > 0);
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
