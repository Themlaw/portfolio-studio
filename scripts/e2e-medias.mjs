#!/usr/bin/env node
/**
 * Lot « médias », de bout en bout, UN navigateur (chromium ; BROWSER=firefox
 * pour A et B). Serveur dev requis (base de test), une connexion admin. Mise
 * en place par l'admin, idempotente (scripts/lib/medias-setup.mjs) : planche
 * « Bande lot 3 » (8 images) et blocs « Vidéo » et « CV » en fin de page
 * Personnages.
 *
 *  A. Bande : flèches sur les bords (centrées sur les images, discrètes,
 *     désactivées en butée, clavier), une image à la fois, fondu des bords
 *     (masque, pixels), plus de flèches dans l'en-tête.
 *  B. Visionneuse : image à nu (ni passe-partout ni cadre), fond gris NEUTRE
 *     pour chaque thème livré (calculé et au pixel), flèches, ← → Échap,
 *     balayage ; cadre gardé sur les tuiles de collection ; curseur main
 *     (variable --t-cursor-pointer).
 *  C. Lecteur vidéo : lecture / pause, barre (clic, glisser en arrière),
 *     ← / →, muet, plein écran (API), « Revoir » à la fin, commandes masquées
 *     pendant la lecture, lecture en Range (206).
 *  D. CV : pages en images, visionneuse, bouton de téléchargement (pièce
 *     jointe, nom propre, nosniff) ; sur la toile : « Remplacer le PDF » au
 *     survol, PDF déposé sur le bloc.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… node scripts/e2e-medias.mjs
 *         ONLY=AB BROWSER=firefox node scripts/e2e-medias.mjs
 */
import { readFileSync } from "node:fs";

import { chromium, firefox } from "playwright";

import { ensureCvBlock, ensureLongStrip, ensureVideoBlock, login, makePdf, pageIdOf, q1, VIDEO_TITLE } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3103";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.includes(s);
const ENGINE = process.env.BROWSER === "firefox" ? firefox : chromium;
const SHOTS = process.env.SHOTS ?? "/root/shots-lot3/e2e";

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await ENGINE.launch(ENGINE === chromium ? { args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await login(page, BASE);
const slug = await ensureLongStrip(page, BASE);
if (run("C")) await ensureVideoBlock(page, BASE);
if (run("D")) await ensureCvBlock(page, BASE);
const stripSel = `section[aria-labelledby="project-${slug}"]`;
// Mise en place finie : on laisse se terminer une navigation qu'elle aurait lancée.
await page.waitForLoadState("networkidle").catch(() => {});

/**
 * `page.goto` tolérant à une navigation que la page précédente n'a pas finie :
 * Firefox l'abandonne (NS_BINDING_ABORTED) au lieu de la remplacer, ou une
 * redirection tardive de la mise en place (enregistrement → /admin/pages/<id>)
 * l'interrompt. Nouvel essai, rien d'autre.
 */
async function goto(url, options) {
  for (let i = 0; ; i++) {
    try {
      return await page.goto(url, options);
    } catch (error) {
      if (i >= 2 || !/NS_BINDING_ABORTED|frame was detached|interrupted by another navigation/.test(String(error))) throw error;
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
    }
  }
}

/** Pixel (r, g, b) d'une capture à (x, y) de la fenêtre. */
async function pixel(x, y) {
  const { default: sharp } = await import("sharp");
  const buf = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
  const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}
/** Couleur calculée → [r, g, b, a?] (rgb()/rgba(), ou color(srgb …) que rend color-mix). */
function parseRgb(s) {
  const rgb = /rgba?\(([^)]+)\)/.exec(s);
  if (rgb) return rgb[1].split(",").map((v) => Number(v.trim()));
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(s);
  if (srgb) return [...srgb.slice(1, 4).map((v) => Math.round(Number(v) * 255)), ...(srgb[4] ? [Number(srgb[4])] : [])];
  return [];
}

/* ---- A. Bande ------------------------------------------------------------------------ */

if (run("A")) {
  await goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const strip = page.locator(stripSel);
  await strip.scrollIntoViewIfNeeded();
  const rail = strip.locator(".strip-rail");
  const prev = strip.locator(".strip-nav-prev");
  const next = strip.locator(".strip-nav-next");
  ok("A1 en-tête : « N œuvres » gardé, plus de flèches en haut à droite (le bouton « Ajouter des images » du lot 25 est une commande de la toile)", (await strip.locator("header .rail-arrow, header button:not(.pe-board-add)").count()) === 0 && /8 œuvres/i.test((await strip.locator("header .strip-count").textContent()) ?? ""), (await strip.locator("header").innerHTML()).slice(0, 600));
  ok("A2 deux flèches posées sur la bande, avec un nom accessible", (await prev.count()) === 1 && (await next.count()) === 1 && /Image suivante/.test((await next.getAttribute("aria-label")) ?? ""));
  await page.mouse.move(5, 5);
  await sleep(400);
  const opacityRest = await next.evaluate((b) => getComputedStyle(b).opacity);
  const rb = await rail.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await sleep(500);
  const opacityHover = await next.evaluate((b) => getComputedStyle(b).opacity);
  ok("A3 discrètes : invisibles au repos, visibles au survol de la bande", opacityRest === "0" && opacityHover === "1", `${opacityRest} → ${opacityHover}`);
  const img = await strip.locator(".strip-frame img").first().boundingBox();
  const nb = await next.boundingBox();
  const pb = await prev.boundingBox();
  ok("A4 centrées verticalement sur les images (± 3 px), à gauche et à droite de la bande", Math.abs(nb.y + nb.height / 2 - (img.y + img.height / 2)) <= 3 && pb.x < 120 && nb.x + nb.width > 1440 - 120, `${nb.y + nb.height / 2} / ${img.y + img.height / 2}`);
  ok("A5 en butée gauche : « précédente » désactivée, « suivante » active", (await prev.isDisabled()) && !(await next.isDisabled()));
  const stops = await rail.evaluate((r) => {
    const pad = parseFloat(getComputedStyle(r).paddingLeft);
    const left = r.getBoundingClientRect().left - r.scrollLeft;
    return [...r.querySelectorAll(".strip-frame")].map((f) => Math.round(f.getBoundingClientRect().left - left - pad));
  });
  await next.click();
  await sleep(1200);
  const s1 = await rail.evaluate((r) => r.scrollLeft);
  ok("A6 « suivante » : avance d'UNE image (calée sur la 2e)", Math.abs(s1 - stops[1]) <= 2, `${s1} / ${stops[1]}`);
  // Deux appuis rapprochés : deux images, pas une hésitation.
  await next.click();
  await next.click();
  await sleep(1400);
  const s3 = await rail.evaluate((r) => r.scrollLeft);
  ok("A7 deux appuis rapprochés : deux images de plus (cible cumulée)", Math.abs(s3 - stops[3]) <= 2, `${s3} / ${stops[3]}`);
  ok("A8 après défilement : « précédente » active", !(await prev.isDisabled()));
  // Fondu : masque dégradé, bord gauche apparu, pixels du bord ≈ fond de page.
  const mask = await rail.evaluate((r) => {
    const cs = getComputedStyle(r);
    return { image: cs.maskImage || cs.webkitMaskImage, l: cs.getPropertyValue("--strip-fade-l"), r: cs.getPropertyValue("--strip-fade-r") };
  });
  // Bord inactif : 0px ; actif : la largeur du fondu (expression en % de la bande).
  // Lot 17b : chaque bord ne se fond que contre une image réellement coupée par ce bord.
  const cuts = await rail.evaluate((r) => {
    const v = r.getBoundingClientRect();
    const f = [...r.querySelectorAll(".strip-frame")].map((e) => e.getBoundingClientRect());
    // Coupée d'au moins 1 px (en deçà, rien de visible à estomper).
    return { l: f.some((b) => b.left < v.left - 1 && b.right > v.left + 1), r: f.some((b) => b.left < v.right - 1 && b.right > v.right + 1), raw: f.map((b) => [Math.round(b.left - v.left), Math.round(b.right - v.left)]).filter(([l, r]) => r > -50 && l < v.width + 50) };
  });
  ok("A9 fondu : masque dégradé sur la bande, un bord ne se fond que s'il coupe une image", /linear-gradient/.test(mask.image) && (mask.l.trim() !== "0px") === cuts.l && (mask.r.trim() !== "0px") === cuts.r && mask.l.trim() !== "0px", JSON.stringify({ mask, cuts }));
  await page.mouse.move(5, 5);
  await sleep(600);
  const bg = parseRgb(await page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, stripSel));
  const pageBg = bg.length >= 3 && bg[3] !== 0 ? bg : parseRgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  const midY = img.y + img.height / 2;
  const edge = await pixel(1438, midY);
  const inner = await pixel(720, midY);
  const near = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
  ok("A10 bord droit : l'image coupée disparaît dans le fond (pixel du bord ≈ fond) ; sans image coupée, rien n'est estompé", (!cuts.r || near(edge, pageBg, 10)) && !near(inner, pageBg, 10), `bord ${edge} fond ${pageBg} centre ${inner}`);
  await page.screenshot({ path: `${SHOTS}-A-fondu.png`, clip: { x: 0, y: rb.y - 20, width: 1440, height: rb.height + 40 } });
  // Butée droite au clavier : focus sur « suivante », Entrée jusqu'au bout.
  await next.focus();
  ok("A11 focus clavier : la flèche s'affiche", (await next.evaluate((b) => getComputedStyle(b).opacity)) === "1");
  for (let i = 0; i < 10 && !(await next.isDisabled()); i++) {
    await page.keyboard.press("Enter");
    await sleep(700);
  }
  await sleep(600);
  const end = await rail.evaluate((r) => ({ left: r.scrollLeft, slack: r.scrollWidth - r.clientWidth, r: getComputedStyle(r).getPropertyValue("--strip-fade-r") }));
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  ok("A12 butée droite : « suivante » désactivée, focus passé à « précédente », fondu droit retiré", (await next.isDisabled()) && /strip-nav-prev/.test(focused) && Math.abs(end.left - end.slack) <= 2 && end.r.trim() === "0px", `${JSON.stringify(end)} focus=${focused}`);
  // « Précédente » : recule d'UNE image à chaque clic, jusqu'à la butée gauche (régression :
  // `disabled` figé dans le JSX, React ignorait tout clic sur la flèche gauche).
  const clamped = stops.map((x) => Math.min(end.slack, Math.max(0, x)));
  const behind = [...new Set([0, ...clamped])].filter((x) => x < end.left - 4).pop();
  await prev.click();
  await sleep(1200);
  const back1 = await rail.evaluate((r) => r.scrollLeft);
  ok("A12b « précédente » : un clic recule d'UNE image (la flèche gauche répond)", behind !== undefined && Math.abs(back1 - behind) <= 2, `${back1} / ${behind} (butée ${end.left})`);
  await prev.click();
  await prev.click();
  await sleep(1400);
  const back3 = await rail.evaluate((r) => r.scrollLeft);
  ok("A12c « précédente » : deux clics rapprochés reculent de deux images (cible cumulée)", back3 < back1 - 100, `${back1} → ${back3}`);
  for (let i = 0; i < 10 && !(await prev.isDisabled()); i++) {
    await prev.click();
    await sleep(900);
  }
  ok("A12d « précédente » mène à la butée gauche (désactivée, début atteint)", (await prev.isDisabled()) && (await rail.evaluate((r) => r.scrollLeft)) <= 2);
  await rail.evaluate((r) => r.scrollTo({ left: r.scrollWidth, behavior: "auto" }));
  await sleep(500);
  // Barre : glisser jusqu'au début sans à-coup (accrochage suspendu pendant le glisser).
  const bar = strip.locator(".rail-bar");
  const bb = await bar.boundingBox();
  const backs = await page.evaluate((s) => {
    const r = document.querySelector(`${s} .strip-rail`);
    window.__backs = 0;
    window.__last = r.scrollLeft;
    r.addEventListener("scroll", () => {
      if (r.scrollLeft > window.__last + 0.5) window.__backs++;
      window.__last = r.scrollLeft;
    });
    return 0;
  }, stripSel);
  await page.mouse.move(bb.x + bb.width - 4, bb.y + bb.height / 2);
  await page.mouse.down();
  ok("A13 glisser la barre : accrochage suspendu pendant le geste", await rail.evaluate((r) => r.hasAttribute("data-dragging") && getComputedStyle(r).scrollSnapType.startsWith("none")));
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(bb.x + bb.width - 4 - ((bb.width - 8) * i) / 40, bb.y + bb.height / 2);
    await sleep(16);
  }
  const after = await page.evaluate(() => ({ backs: window.__backs }));
  await page.mouse.up();
  await sleep(500);
  const thumb = await strip.locator(".rail-bar-thumb").evaluate((t) => ({ left: t.style.left, transform: t.style.transform }));
  ok("A14 glisser vers la gauche : aucun retour en arrière, curseur déplacé par transform (pas left)", after.backs === backs && !thumb.left && /translate3d/.test(thumb.transform), JSON.stringify({ ...after, ...thumb }));
  ok("A15 de retour au début : « précédente » désactivée", await prev.isDisabled());
}

/* ---- B. Visionneuse --------------------------------------------------------------- */

const PRESETS = ["pro", "galerie-lumineuse", "carnet-d-atelier", "salle-de-projection"];
if (run("B")) {
  for (const preset of PRESETS) {
    await goto(`${BASE}/api/theme-preview?id=${preset}&banner=0`, { waitUntil: "networkidle" });
    await goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const strip = page.locator(stripSel);
    await strip.scrollIntoViewIfNeeded();
    await strip.locator(".strip-frame").nth(1).click();
    const lb = page.locator(".lightbox");
    await lb.waitFor();
    await sleep(700);
    const frame = await page.locator(".lightbox-frame").evaluate((f) => {
      const cs = getComputedStyle(f);
      return { pad: cs.paddingTop, border: cs.borderTopWidth, shadow: cs.boxShadow, bg: cs.backgroundColor, img: cs.borderImageSource };
    });
    const bgc = parseRgb(await lb.evaluate((e) => getComputedStyle(e).backgroundColor));
    const px = await pixel(8, 450);
    const neutral = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= 1;
    ok(
      `B1 ${preset} : image à nu (sans passe-partout ni cadre), fond gris neutre opaque (calculé ${bgc.join(",")}, pixel ${px.join(",")})`,
      frame.pad === "0px" && frame.border === "0px" && frame.shadow === "none" && /rgba\(0, 0, 0, 0\)|transparent/.test(frame.bg) && (frame.img === "none" || !frame.img) && neutral(bgc) && (bgc[3] === undefined || bgc[3] === 1) && neutral(px),
      JSON.stringify(frame),
    );
    if (preset === "pro") await page.screenshot({ path: `${SHOTS}-B-visionneuse.png` });
    await page.keyboard.press("Escape");
  }
  await goto(`${BASE}/api/theme-preview?id=&banner=0`, { waitUntil: "networkidle" });
  await goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const strip = page.locator(stripSel);
  await strip.scrollIntoViewIfNeeded();
  const firstFrame = strip.locator(".strip-frame").first();
  ok("B2 curseur main sur une image cliquable", (await firstFrame.locator("img").evaluate((i) => getComputedStyle(i).cursor)) === "pointer");
  await page.evaluate(() => document.documentElement.style.setProperty("--t-cursor-pointer", "crosshair"));
  ok("B3 curseur : --t-cursor-pointer du thème honoré (repli pointer sinon)", (await firstFrame.locator("img").evaluate((i) => getComputedStyle(i).cursor)) === "crosshair");
  await page.evaluate(() => document.documentElement.style.removeProperty("--t-cursor-pointer"));
  await firstFrame.click();
  const lb = page.locator(".lightbox");
  await lb.waitFor();
  const pos = () => lb.locator(".eyebrow").first().textContent();
  ok("B4 flèches gauche / droite présentes", (await lb.getByRole("button", { name: "Œuvre suivante" }).count()) === 1 && (await lb.getByRole("button", { name: "Œuvre précédente" }).count()) === 1);
  await page.keyboard.press("ArrowRight");
  ok("B5 → : œuvre suivante", (await pos()) === "2 / 8", await pos());
  await page.keyboard.press("ArrowLeft");
  ok("B6 ← : œuvre précédente", (await pos()) === "1 / 8", await pos());
  // Balayage au doigt (événements pointeur « touch ») : vers la gauche = suivante.
  await lb.locator(".lightbox-stage").evaluate((el) => {
    const ev = (type, x) => new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: 400, isPrimary: true });
    el.dispatchEvent(ev("pointerdown", 900));
    el.dispatchEvent(ev("pointerup", 700));
  });
  ok("B7 balayage vers la gauche : œuvre suivante", (await pos()) === "2 / 8", await pos());
  await lb.locator(".lightbox-stage").evaluate((el) => {
    const ev = (type, x) => new PointerEvent(type, { bubbles: true, pointerId: 8, pointerType: "touch", clientX: x, clientY: 400, isPrimary: true });
    el.dispatchEvent(ev("pointerdown", 600));
    el.dispatchEvent(ev("pointerup", 900));
  });
  ok("B8 balayage vers la droite : œuvre précédente", (await pos()) === "1 / 8", await pos());
  await page.keyboard.press("Escape");
  ok("B9 Échap : fermée, focus rendu à l'image d'origine", (await lb.count()) === 0 && (await page.evaluate(() => document.activeElement?.classList.contains("strip-frame"))));
  // Tuiles de collection (accueil) : le passe-partout reste.
  await goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const tile = page.locator(".tile-media").first();
  if (await tile.count()) {
    const t = await tile.evaluate((e) => ({ pad: getComputedStyle(e).paddingTop, cursor: getComputedStyle(e.querySelector("img")).cursor }));
    ok("B10 tuiles de collection : cadre (passe-partout) gardé, curseur main", parseFloat(t.pad) > 0 && t.cursor === "pointer", JSON.stringify(t));
  } else ok("B10 tuiles de collection présentes sur l'accueil", false);
}

/* ---- C. Lecteur vidéo ---------------------------------------------------------------- */

if (run("C") && ENGINE === chromium) {
  // Visiteur anonyme : la session de l'admin porte le cookie de la vue brouillon (page rendue comme sur la toile, où la vidéo ne s'ouvre pas en grand).
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cpage = await anon.newPage();
  cpage.on("pageerror", (e) => errors.push(e.message));
  const ranges = [];
  cpage.on("response", (r) => r.url().includes("/media/vid/") && ranges.push(r.status()));
  await cpage.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const card = cpage.locator('.group:has([data-kind="video"])', { hasText: VIDEO_TITLE }).first();
  await card.scrollIntoViewIfNeeded();
  // Lot 36 : le Lecteur s'ouvre en grand dans la visionneuse (le lecteur maison est le même).
  await card.getByRole("button", { name: `Lire ${VIDEO_TITLE}` }).click();
  const vp = cpage.locator(".video-viewer .vp");
  await vp.waitFor();
  const video = vp.locator("video");
  const st = () => vp.getAttribute("data-state");
  const t = () => video.evaluate((v) => v.currentTime);
  await cpage.waitForFunction((el) => el.getAttribute("data-state") === "playing", await vp.elementHandle(), { timeout: 15000 }).catch(() => {});
  ok("C1 « Lire » : lecture lancée, lecteur maison (aucune commande native)", (await st()) === "playing" && !(await video.evaluate((v) => v.controls)));
  await sleep(1200);
  ok("C2 le temps avance", (await t()) > 0.5, String(await t()));
  await vp.hover();
  await vp.getByRole("button", { name: "Pause" }).click();
  await vp.and(cpage.locator('[data-state="paused"]')).waitFor({ timeout: 5000 }).catch(() => {});
  ok("C3 pause", (await st()) === "paused" && (await video.evaluate((v) => v.paused)));
  const seek = vp.locator(".vp-seek");
  const sb = await seek.boundingBox();
  await cpage.mouse.click(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
  await sleep(500);
  const d = await video.evaluate((v) => v.duration);
  ok("C4 clic sur la barre (50 %) : position au milieu", Math.abs((await t()) - d / 2) < 1.2, `${await t()} / ${d}`);
  // Glisser vers l'arrière : de 80 % à 20 %.
  await cpage.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height / 2);
  await cpage.mouse.down();
  await cpage.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2, { steps: 6 });
  await cpage.mouse.move(sb.x + sb.width * 0.2, sb.y + sb.height / 2, { steps: 6 });
  await cpage.mouse.up();
  await sleep(500);
  ok("C5 glisser la barre en arrière (80 % → 20 %)", Math.abs((await t()) - d * 0.2) < 1.2, `${await t()}`);
  ok("C6 barre accessible (slider, valeur texte)", (await seek.getAttribute("role")) === "slider" && /sur/.test((await seek.getAttribute("aria-valuetext")) ?? ""));
  await vp.focus();
  const t0 = await t();
  await cpage.keyboard.press("ArrowRight");
  await sleep(300);
  const t1 = await t();
  await cpage.keyboard.press("ArrowLeft");
  await sleep(300);
  const t2 = await t();
  ok("C7 clavier → / ← : ± 10 s", Math.abs(t1 - t0 - 10) < 0.8 && Math.abs(t1 - t2 - 10) < 0.8, `${t0} → ${t1} → ${t2}`);
  await cpage.keyboard.press("Space");
  await sleep(600);
  ok("C8 Espace : lecture", (await st()) === "playing");
  await cpage.keyboard.press("m");
  // Le bouton suit au rendu suivant : l'attendre (5 s) avant de le compter.
  await vp.getByRole("button", { name: "Remettre le son" }).waitFor({ timeout: 5000 }).catch(() => {});
  ok("C9 M : muet (bouton à jour)", (await video.evaluate((v) => v.muted)) && (await vp.getByRole("button", { name: "Remettre le son" }).count()) === 1);
  await cpage.keyboard.press("m");
  // Commandes masquées pendant la lecture, sans geste.
  await cpage.mouse.move(5, 5);
  await sleep(3200);
  const idle = await vp.evaluate((e) => ({ idle: e.hasAttribute("data-idle"), op: getComputedStyle(e.querySelector(".vp-bar")).opacity }));
  const vb = await vp.boundingBox();
  await cpage.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await sleep(400);
  const woke = await vp.evaluate((e) => !e.hasAttribute("data-idle"));
  ok("C10 commandes masquées pendant la lecture, revenues au moindre geste", idle.idle && idle.op === "0" && woke, JSON.stringify(idle));
  // Plein écran (API).
  await vp.getByRole("button", { name: "Plein écran" }).click();
  await sleep(600);
  const fs = await cpage.evaluate(() => document.fullscreenElement?.classList.contains("vp") ?? false);
  await cpage.keyboard.press("f");
  await sleep(600);
  const fsOut = await cpage.evaluate(() => document.fullscreenElement === null);
  ok("C11 plein écran : entrée (bouton) et sortie (F)", fs && fsOut, `${fs} ${fsOut}`);
  // Fin : « Revoir ».
  await video.evaluate((v) => {
    v.currentTime = v.duration - 0.4;
    return v.play();
  });
  await cpage.waitForFunction((el) => el.getAttribute("data-state") === "ended", await vp.elementHandle(), { timeout: 10000 }).catch(() => {});
  const replay = vp.locator(".vp-big", { hasText: "Revoir" });
  ok("C12 fin : « Revoir » affiché", (await st()) === "ended" && (await replay.count()) === 1);
  await replay.click();
  await sleep(800);
  ok("C13 « Revoir » : relance depuis le début", (await st()) === "playing" && (await t()) < 3, String(await t()));
  ok("C14 lecture progressive en Range (206) conservée", ranges.includes(206), ranges.join(","));
  await cpage.screenshot({ path: `${SHOTS}-C-lecteur.png`, clip: { x: 0, y: Math.max(0, vb.y - 10), width: 1440, height: Math.min(880, vb.height + 20) } });
  ok("C15 boucles : jamais de lecteur à commandes", (await cpage.locator("[data-loop] .vp").count()) === 0);
  await cpage.keyboard.press("Escape");
  await cpage.locator(".video-viewer").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await anon.close();
}

/* ---- D. CV ---------------------------------------------------------------------------- */

if (run("D") && ENGINE === chromium) {
  await goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const cv = page.locator(".cv-block").first();
  await cv.scrollIntoViewIfNeeded();
  await sleep(800);
  const imgs = await cv.locator(".cv-page img").evaluateAll((list) => list.map((i) => ({ w: i.naturalWidth, src: i.currentSrc })));
  ok("D1 CV : 2 pages en images (AVIF/WebP), chargées", imgs.length === 2 && imgs.every((i) => i.w > 0 && /\/media\/doc\/[0-9a-f]{16}\/p\d-\d+\.(avif|webp)$/.test(i.src)), JSON.stringify(imgs));
  const btn = cv.getByRole("link", { name: "Télécharger mon CV" });
  ok("D2 bouton « Télécharger mon CV » bien visible (bouton du thème)", (await btn.count()) === 1 && (await btn.isVisible()) && /\bbtn\b/.test((await btn.getAttribute("class")) ?? ""));
  const href = await btn.getAttribute("href");
  const res = await page.request.get(`${BASE}${href}`);
  const hd = res.headers();
  ok("D3 téléchargement : PDF d'origine en pièce jointe, nom propre, nosniff", res.status() === 200 && hd["content-type"] === "application/pdf" && hd["content-disposition"] === 'attachment; filename="cv.pdf"' && hd["x-content-type-options"] === "nosniff" && (await res.body()).subarray(0, 5).toString() === "%PDF-", JSON.stringify(hd));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), btn.click()]);
  ok("D4 clic : le navigateur ENREGISTRE le fichier (jamais affiché), nom cv.pdf", download.suggestedFilename() === "cv.pdf", download.suggestedFilename());
  await cv.locator(".cv-page").first().click();
  const lb = page.locator(".lightbox");
  await lb.waitFor();
  ok("D5 page cliquée : visionneuse « Page 1 sur 2 », → passe à la page 2", /Page 1 sur 2/.test((await lb.locator("h2").textContent()) ?? ""));
  await page.keyboard.press("ArrowRight");
  ok("D6 → : page 2", /Page 2 sur 2/.test((await lb.locator("h2").textContent()) ?? ""));
  await page.keyboard.press("Escape");
  const box = await cv.boundingBox();
  await page.screenshot({ path: `${SHOTS}-D-cv.png`, clip: { x: 0, y: box.y, width: 1440, height: Math.min(900, box.height) } });
  // Toile : remplacer au survol, PDF déposé sur le bloc.
  const pid = pageIdOf("personnages");
  await goto(`${BASE}/admin/pages/${pid}/editer`, { waitUntil: "domcontentloaded" });
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 90000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 120000 });
  const target = f.locator('[data-edit-type="cv"] [data-edit-media="mediaId"]').first();
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  const tools = await f.waitForFunction(() => [...document.querySelectorAll(".pe-media-tools button")].some((b) => b.textContent === "Remplacer le PDF"), null, { timeout: 10000 }).then(() => true, () => false);
  ok("D7 toile : « Remplacer le PDF » au survol du CV", tools);
  const bytes = [...readFileSync(makePdf(1, "lot3-cv-v2.pdf"))];
  const dt = await f.evaluateHandle((b) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(b)], "lot3-cv-v2.pdf", { type: "application/pdf" }));
    return data;
  }, bytes);
  const tb = await target.boundingBox();
  const fb = await page.locator("iframe.ve-frame").boundingBox();
  await target.dispatchEvent("dragover", { dataTransfer: dt, clientX: tb.x - fb.x + tb.width / 2, clientY: tb.y - fb.y + 40 });
  await target.dispatchEvent("drop", { dataTransfer: dt, clientX: tb.x - fb.x + tb.width / 2, clientY: tb.y - fb.y + 40 });
  let placed = false;
  for (let i = 0; i < 90 && !placed; i++) {
    await sleep(1000);
    const draft = JSON.parse(q1("select draft from pages where id = ?", pid)?.draft ?? "null");
    const v2 = q1("select id from media where original_name = 'lot3-cv-v2.pdf'")?.id;
    placed = Boolean(v2) && JSON.stringify(draft?.blocks ?? []).includes(`"mediaId":${v2}`);
  }
  ok("D8 toile : PDF déposé sur le bloc → envoyé, rendu, posé dans le brouillon", placed);
  // Remise en état : brouillon abandonné.
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click();
    await sleep(1500);
  }
}

// Firefox : une requête de préchargement interrompue par une navigation remonte en
// « NetworkError » (bruit du test, pas une erreur du site).
const real = errors.filter((e) => !(ENGINE === firefox && /NetworkError when attempting to fetch resource/.test(e)));
ok("Z aucune erreur JavaScript dans la page", real.length === 0, real.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\ne2e-medias : TOUT PASSE");
process.exit(failures ? 1 : 0);
