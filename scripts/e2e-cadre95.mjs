#!/usr/bin/env node
/**
 * Lot 95 « Couleur du cadre Bordure : la pastille = la couleur du cadre » (chromium, serveur requis, base neuve, une connexion admin).
 * Tout est SYNTHÉTIQUE (images peintes, thèmes de série, kit de Studio redessiné par simulate-multi, papier de cœurs).
 *
 * Pour chaque thème (Galerie lumineuse, Carnet d'atelier, Papier de cœurs, Studio à cadre dessiné) :
 *  M  Menu « Cadre » (éditeur) : pour CHAQUE pastille (défaut, 8 teintes, 3 couleurs libres) : clic, valeur enregistrée (`look.frame.color`),
 *     couleur de la pastille (calculée), couleur calculée de la bordure dans l'éditeur ; et les trois épaisseurs.
 *  C  Contextes, éditeur ET public (après publication) : image seule, bloc à fond de couleur, carte claire, carte sombre, image de planche :
 *     la `border-color` calculée du cadre = la couleur de la pastille, l'épaisseur est > 0, la couleur est opaque.
 *  W  Épaisseurs Fin / Moyen / Épais : 2 px, plus fin que Moyen, plus fin que Épais (public et éditeur).
 * Écrit le tableau « pastille → attendu → éditeur → public → verdict » dans $SHOTS/cadre95-<thème>.json (lignes ROW dans le journal).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=M,C,W] [THEMES=a,b] [SHOTS=dossier] node scripts/e2e-cadre95.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { installPaperTheme, PAPER_THEME_NAME } from "./lib/paper-theme.mjs";
import { sharedOk } from "./lib/parts.mjs";
import { activateThemeUi } from "./lib/theme-live.mjs";
import { boardDraft, draftBlocks, login, makeMedia, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3985";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-cadre95");
mkdirSync(SHOTS, { recursive: true });
const THEME_FILTER = process.env.THEMES ? process.env.THEMES.split(",") : null;

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const M = await makeMedia(page, BASE);
const PHOTOS = pageIdOf("decors");
const project = q1("select id, slug from projects order by id limit 1");
const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });

/* ---- Aides ------------------------------------------------------------------------------------------------------------ */
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor(pageId) {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(2500);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(600);
}
async function publish(pageId, blocks, board) {
  setDraft(pageId, blocks);
  setBoardDraft(project.id, pageId, board ?? []);
  await openEditor(pageId);
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && (!board || boardDraft(project.id) === null), 150000);
  await sleep(2500);
  // Les identifiants de la publication changent : on remet le même brouillon pour la toile.
  setDraft(pageId, blocks);
  setBoardDraft(project.id, pageId, board ?? []);
  return done;
}
const publicPage = async (urlPath) => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle" });
  await sleep(800);
  return p;
};
const lookOf = (pageId, uid) => {
  const find = (list) => {
    for (const b of list) {
      if (b.uid === uid) return b;
      const inner = find(b.props?.children ?? []);
      if (inner) return inner;
    }
    return null;
  };
  return find(draftBlocks(pageId))?.props.look;
};

const rgb = (c) => {
  const m = /rgba?\(([^)]+)\)/.exec(c ?? "");
  if (!m) return null;
  const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a: a === undefined ? 1 : a };
};
const hexRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 });
const same = (x, y) => !!x && !!y && Math.abs(x.r - y.r) <= 1 && Math.abs(x.g - y.g) <= 1 && Math.abs(x.b - y.b) <= 1;
const lum = ({ r, g, b }) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Pour chaque cadre « Bordure » du document : couleur et épaisseur calculées, variable, contexte, fond effectif dessous. */
const measure = (doc) =>
  doc.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".media-frame[data-frame]")) {
      const cs = getComputedStyle(el);
      let bg = "rgba(0, 0, 0, 0)";
      for (let n = el.parentElement; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(c)) {
          bg = c;
          break;
        }
      }
      out.push({
        kind: el.getAttribute("data-frame"),
        color: cs.borderTopColor,
        width: parseFloat(cs.borderTopWidth),
        style: cs.borderTopStyle,
        frameVar: cs.getPropertyValue("--frame-color").trim(),
        inCard: !!el.closest('.surface-card[data-surface="on"]'),
        inFond: !!el.closest('.fond-bloc[data-fond="on"]'),
        bg,
      });
    }
    return out;
  });

/* ---- Thèmes ----------------------------------------------------------------------------------------------------------- */
const PAL = ["bg", "surface", "ink", "primary", "secondary", "tertiary", "ink-soft", "eyebrow"];
const CUSTOM = ["#e63946", "#1d3557", "#f4a261"];
const COLORS = [undefined, ...PAL, ...CUSTOM];
const cname = (c) => c ?? "défaut";
const frameOf = (c, width) => ({ kind: "band", ...(width ? { width } : {}), ...(c ? { color: c } : {}) });
const THEMES = [
  ["galerie-lumineuse", async () => activateThemeUi(page, BASE, "galerie-lumineuse")],
  ["carnet-d-atelier", async () => activateThemeUi(page, BASE, "carnet-d-atelier")],
  ["papier-coeurs", async () => {
    installPaperTheme(process.env.DATA_DIR ?? "data");
    await activateThemeUi(page, BASE, PAPER_THEME_NAME);
  }],
  ["studio-kit-cadre", async () => {
    await installKitFrameTheme(page, BASE, undefined, "cadre58a");
  }],
];

const CTXS = ["image seule", "fond de couleur", "carte claire", "carte sombre", "planche"];
const blockProps = (ctxName) => {
  if (ctxName === "fond de couleur") return { background: { kind: "color", color: "bgDeep" } };
  if (ctxName === "carte claire") return { surface: { color: "primary12", width: "inset", corners: "m" } };
  if (ctxName === "carte sombre") return { surface: { color: "ink", width: "inset", corners: "m" } };
  return {};
};

for (const [themeId, activate] of THEMES) {
  if (THEME_FILTER && !THEME_FILTER.includes(themeId)) continue;
  await section(`thème ${themeId}`, async () => {
    await activate();
    console.log(`\n===== thème ${themeId} =====`);
    const table = [];
    const swatchBg = {}; // pastille → couleur calculée
    const menuRows = [];

    /* ---- M. Le menu, pastille par pastille ---- */
    if (run("M")) {
      setDraft(PHOTOS, [img("m1", M.carre, { look: { frame: frameOf(undefined) } })]);
      const fr = await openEditor(PHOTOS);
      const el = fr.locator('[data-edit-block="m1"] .media-frame').first();
      await el.scrollIntoViewIfNeeded();
      await el.click();
      await sleep(500);
      const dlg = fr.getByRole("dialog", { name: "Cadre de la photo" });
      if (!(await dlg.isVisible().catch(() => false))) await fr.locator('.pe-tools [data-testid="frame-button"]').click();
      await dlg.waitFor({ timeout: 15000 });
      const readBorder = async () => (await measure(fr))[0];
      const swatchColor = (sel) => dlg.locator(sel).evaluate((b) => getComputedStyle(b).backgroundColor);
      // La couleur du THÈME de chaque teinte (ce que la pastille doit montrer et le cadre prendre), lue par une sonde dans la toile.
      const tokens = await fr.evaluate((keys) => {
        const probe = document.createElement("span");
        document.body.appendChild(probe);
        const out = {};
        for (const [k, css] of Object.entries(keys)) {
          probe.style.color = css;
          out[k] = getComputedStyle(probe).color;
        }
        probe.remove();
        return out;
      }, { "défaut": "var(--color-ink)", page: "var(--t-color-bg)", ...Object.fromEntries(PAL.map((c) => [c, `var(--t-color-${c})`])) });
      Object.assign(swatchBg, tokens);
      const sels = { "défaut": '[data-frame-color="default"]', ...Object.fromEntries(PAL.map((c) => [c, `[data-frame-color="${c}"]`])) };
      // Pastilles proposées au départ : distinctes entre elles, et aucune ne se confond avec le fond de la page.
      const offered = [];
      for (const [name, sel] of Object.entries(sels)) if (await dlg.locator(sel).count()) offered.push([name, rgb(await swatchColor(sel))]);
      const hidden = Object.keys(sels).filter((n) => !offered.some(([o]) => o === n));
      info(`${themeId} pastilles proposées / masquées`, [offered.map(([n]) => n), hidden]);
      const twins = [];
      for (let i = 0; i < offered.length; i++)
        for (let j = i + 1; j < offered.length; j++) {
          const [x, y] = [offered[i][1], offered[j][1]];
          if (Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b)) <= 6) twins.push(`${offered[i][0]} = ${offered[j][0]}`);
        }
      ok(`M ${themeId} · aucune pastille en double (deux pastilles de la même couleur)`, twins.length === 0, twins.join(" ; "));
      const pageBg = rgb(swatchBg.page);
      const blends = offered.filter(([n, c]) => n !== "défaut" && contrast(c, pageBg) < 1.3).map(([n]) => n);
      ok(`M ${themeId} · aucune pastille ne se confond avec le fond de la page (cadre invisible)`, blends.length === 0, blends.join(", "));
      for (const [name, sel] of Object.entries(sels)) {
        if (hidden.includes(name)) {
          console.log(`MENU ${themeId} | ${name} | pastille masquée (doublon ou confondue avec le fond) | couleur du thème ${swatchBg[name]}`);
          continue;
        }
        const want = name === "défaut" ? undefined : name;
        const shownColor = await swatchColor(sel);
        await dlg.locator(sel).click();
        await waitFor(() => lookOf(PHOTOS, "m1")?.frame?.color === want, 20000);
        await sleep(700);
        const b = await readBorder();
        const stored = lookOf(PHOTOS, "m1")?.frame?.color ?? "(aucune)";
        const row = { color: name, swatch: shownColor, token: swatchBg[name], stored, editor: b.color, width: b.width, frameVar: b.frameVar };
        menuRows.push(row);
        console.log(`MENU ${themeId} | ${name} | pastille ${row.swatch} | enregistré ${stored} | bordure ${row.editor} ${row.width}px (var « ${row.frameVar} »)`);
        ok(`M ${themeId} · pastille « ${name} » : enregistrée (${stored}) et la bordure de l'éditeur a la couleur de la pastille (${row.swatch})`, stored === (want ?? "(aucune)") && b.width > 0 && same(rgb(b.color), rgb(row.swatch)) && rgb(b.color)?.a === 1, `bordure ${b.color} ${b.width}px, var « ${b.frameVar} »`);
      }
      for (const hex of CUSTOM) {
        await dlg.getByRole("button", { name: "Couleur personnalisée" }).click();
        const input = fr.locator('.cp input[aria-label="Code couleur"]');
        await input.waitFor({ timeout: 20000 });
        await input.fill(hex);
        await input.press("Enter");
        await waitFor(() => lookOf(PHOTOS, "m1")?.frame?.color === hex, 20000);
        await sleep(700);
        await page.keyboard.press("Escape");
        await sleep(300);
        if (!(await dlg.isVisible().catch(() => false))) await fr.locator('.pe-tools [data-testid="frame-button"]').click();
        await dlg.waitFor();
        const b = await readBorder();
        const stored = lookOf(PHOTOS, "m1")?.frame?.color;
        menuRows.push({ color: hex, swatch: hex, stored, editor: b.color, width: b.width, frameVar: b.frameVar });
        console.log(`MENU ${themeId} | ${hex} | enregistré ${stored} | bordure ${b.color} ${b.width}px`);
        ok(`M ${themeId} · couleur libre ${hex} : enregistrée et la bordure a exactement cette couleur`, stored === hex && b.width > 0 && same(rgb(b.color), hexRgb(hex)), `bordure ${b.color} ${b.width}px, var « ${b.frameVar} »`);
      }
      // Épaisseurs
      const widths = {};
      for (const w of ["fin", "moyen", "epais"]) {
        await dlg.locator(`[data-frame-width="${w}"]`).click();
        await waitFor(() => lookOf(PHOTOS, "m1")?.frame?.width === w, 20000);
        await sleep(600);
        widths[w] = (await readBorder()).width;
      }
      info(`${themeId} épaisseurs éditeur (fin / moyen / épais)`, widths);
      ok(`W ${themeId} · épaisseurs éditeur : Fin 2 px < Moyen < Épais, toutes visibles`, widths.fin === 2 && widths.moyen > widths.fin && widths.epais > widths.moyen, JSON.stringify(widths));
      // S. Un cadre déjà enregistré garde sa couleur et sa pastille : le jeton masqué (doublon) est remplacé par sa jumelle cochée, le fond de page reste affiché.
      for (const stored of ["eyebrow", "ink", "bg", "surface"]) {
        setDraft(PHOTOS, [img("m1", M.carre, { look: { frame: frameOf(stored) } })]);
        const f2 = await openEditor(PHOTOS);
        const el2 = f2.locator('[data-edit-block="m1"] .media-frame').first();
        await el2.scrollIntoViewIfNeeded();
        await el2.click();
        await sleep(500);
        const d2 = f2.getByRole("dialog", { name: "Cadre de la photo" });
        if (!(await d2.isVisible().catch(() => false))) await f2.locator('.pe-tools [data-testid="frame-button"]').click();
        await d2.waitFor({ timeout: 15000 });
        const checkedColors = await d2.locator('[data-frame-color][aria-checked="true"]').evaluateAll((bs) => bs.map((b) => getComputedStyle(b).backgroundColor));
        const border = (await measure(f2))[0];
        ok(`S ${themeId} · cadre enregistré « ${stored} » : une seule pastille cochée, de la couleur du cadre (${border.color})`, checkedColors.length === 1 && same(rgb(checkedColors[0]), rgb(border.color)) && same(rgb(border.color), rgb(swatchBg[stored])), `cochées : ${checkedColors.join(" | ")} ; cadre ${border.color} ; thème ${swatchBg[stored]}`);
      }
      await shot(page, `${themeId}-menu`);
      menuRows.widths = widths;
    }

    /* ---- C. Les contextes, éditeur ET public (deux tours : 40 blocs au plus par page) ---- */
    if (run("C") || run("W")) {
      const ROUNDS = [
        { name: "tour 1", ctxs: ["image seule", "fond de couleur"], widths: true, board: true },
        { name: "tour 2", ctxs: ["carte claire", "carte sombre"], widths: false, board: false },
      ];
      const expectedOf = (c) => {
        if (c === undefined || c === "ink") return null; // défaut et « Texte » : l encre LISIBLE du contexte (carte, fond), on ne vérifie que la visibilité
        if (CUSTOM.includes(c)) return hexRgb(c);
        return rgb(swatchBg[c] ?? "");
      };
      const bad = { éditeur: {}, public: {} };
      for (const round of ROUNDS) {
        const blocks = [];
        const plan = [];
        if (round.widths)
          for (const w of ["fin", "moyen", "epais"]) {
            blocks.push(img(`w-${w}`, M.carre, { look: { frame: frameOf("primary", w) } }));
            plan.push({ ctx: "épaisseur", color: "primary", width: w });
          }
        COLORS.forEach((c, i) => {
          for (const cx of round.ctxs) {
            blocks.push(img(`x${CTXS.indexOf(cx)}-${i}`, M.carre, { ...blockProps(cx), look: { frame: frameOf(c) } }));
            plan.push({ ctx: cx, color: c });
          }
        });
        let board;
        if (round.board) {
          board = COLORS.map((c, i) => img(`pl-${i}`, M.carre, { look: { frame: frameOf(c) } }));
          COLORS.forEach((c) => plan.push({ ctx: "planche", color: c }));
          blocks.push({ uid: "pbd", type: "project-board", props: { project: project.slug } });
        }
        ok(`C ${themeId} · ${round.name} : page de contextes publiée (${blocks.length} blocs)`, await publish(PHOTOS, blocks, board));
        const pub = await publicPage("/fr/decors");
        const pubM = await measure(pub);
        await shot(pub, `${themeId}-public-${round.name.replace(" ", "")}`);
        await pub.context().close();
        const fr = await openEditor(PHOTOS);
        await settled();
        const edM = await measure(fr);
        info(`${themeId} ${round.name} : nombre de cadres (plan / public / éditeur)`, [plan.length, pubM.length, edM.length]);
        ok(`C ${themeId} · ${round.name} : tous les cadres attendus sont là (public ${pubM.length}, éditeur ${edM.length} sur ${plan.length})`, pubM.length === plan.length && edM.length === plan.length);
        plan.forEach((p, i) => {
          const e = expectedOf(p.color);
          const row = { ctx: p.ctx, color: cname(p.color), width: p.width, attendu: e ? `rgb(${e.r}, ${e.g}, ${e.b})` : "(encre lisible du contexte)" };
          for (const [where, m] of [["éditeur", edM[i]], ["public", pubM[i]]]) {
            if (!m) {
              row[where] = "ABSENT";
              continue;
            }
            const c = rgb(m.color);
            row[where] = `${m.color} ${m.width}px${m.frameVar ? "" : " [--frame-color vide]"}`;
            const visible = m.width > 0 && m.style === "solid" && !!c && c.a === 1;
            const good = visible && (e ? same(c, e) : true);
            row[`${where}Ok`] = good;
            if (!good) (bad[where][p.ctx] ??= []).push(`${cname(p.color)} → ${m.color} ${m.width}px (var « ${m.frameVar} »)`);
          }
          const cm = pubM[i];
          if (cm) {
            const c = rgb(cm.color);
            const back = rgb(cm.bg);
            row.contraste = c && back ? Math.round(contrast(c, back) * 100) / 100 : null;
            row.fondDessous = cm.bg;
            row.contexteOk = p.ctx === "carte claire" || p.ctx === "carte sombre" ? cm.inCard : p.ctx === "fond de couleur" ? cm.inFond : true;
          }
          table.push(row);
          console.log(`ROW ${themeId} | ${row.ctx}${row.width ? " " + row.width : ""} | ${row.color} | attendu ${row.attendu} | éditeur ${row["éditeur"]} | public ${row.public} | ${row["éditeurOk"] && row.publicOk ? "OK" : "ECART"} | contraste ${row.contraste} sur ${row.fondDessous}`);
        });
        if (round.widths) {
          const pw = pubM.slice(0, 3).map((m) => m.width);
          info(`${themeId} épaisseurs public (fin / moyen / épais)`, pw);
          ok(`W ${themeId} · épaisseurs publiques : Fin 2 px < Moyen < Épais`, pw[0] === 2 && pw[1] > pw[0] && pw[2] > pw[1], JSON.stringify(pw));
          const ew = edM.slice(0, 3).map((m) => m.width);
          ok(`W ${themeId} · épaisseurs éditeur = public`, JSON.stringify(ew) === JSON.stringify(pw), `${JSON.stringify(ew)} / ${JSON.stringify(pw)}`);
        }
        await shot(page, `${themeId}-editeur-${round.name.replace(" ", "")}`);
      }
      for (const cx of ["épaisseur", ...CTXS]) {
        for (const where of ["éditeur", "public"]) {
          const list = bad[where][cx] ?? [];
          ok(`C ${themeId} · ${cx} · ${where} : chaque cadre a la couleur de sa pastille, visible`, list.length === 0, list.join(" | "));
        }
      }
      ok(`C ${themeId} · les contextes sont bien ceux annoncés (carte, fond posés)`, table.filter((r) => r.contexteOk === false).length === 0, table.filter((r) => r.contexteOk === false).map((r) => r.ctx).slice(0, 4).join(","));
    }
    writeFileSync(path.join(SHOTS, `cadre95-${themeId}.json`), JSON.stringify({ themeId, swatchBg, menuRows, table }, null, 1));
  });
}

// Vérification de fin de suite, rejouée par chaque partie (THEMES=…) : comptée PASS une seule fois (lib/parts.mjs).
sharedOk(ok)("aucune erreur JavaScript dans la page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nTOUT PASSE" : `\n${failures} ECHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
