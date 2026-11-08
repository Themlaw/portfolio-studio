#!/usr/bin/env node
/**
 * Sécurité v1.0 : SVG et images de cadres. Couvre #14 (svgProblem linéaire, 512 Ko, UTF-8), #3 (looksSvg exponentiel, liste
 * blanche avant/après svgo) et #18 (sharp borné dans la requête d'import). PASS = attaque bloquée.
 * Usage (dans le conteneur Playwright / vips) : node --import tsx scripts/secuB-svg.mjs [14|3|18]   (vide = tout)
 * Sur v0.34.0 sans correctif : échecs (ReDoS, SVG hostiles acceptés, rendu non borné).
 */
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { emit, finish, freshData, info, ok, ROOT, runChild } from "./lib/secu-b.mjs";

const SELF = new URL(import.meta.url).pathname;

/* ================================================================ enfant ==== */
if (process.argv[2] === "child") {
  const kind = process.argv[3];
  const args = process.argv.slice(4);
  const t0 = performance.now();
  const frame = async (file) => {
    const { registerHooks } = await import("node:module");
    const svgoBrowser = new URL("../node_modules/svgo/dist/svgo.browser.js", import.meta.url).href;
    registerHooks({ resolve: (spec, ctx, next) => (spec === "svgo/browser" ? { url: svgoBrowser, format: "module", shortCircuit: true } : next(spec, ctx)) });
    const { importFrame } = await import("../src/lib/edit/frames.ts");
    const { statSync, openSync, readSync, closeSync } = await import("node:fs");
    const fd = openSync(file, "r");
    const head = Buffer.alloc(4100);
    const n = readSync(fd, head, 0, 4100, 0);
    closeSync(fd);
    const t = performance.now();
    const r = await importFrame({ tmpPath: file, size: statSync(file).size, head: head.subarray(0, n), filename: "synthetique.svg" });
    return { ok: r.ok, message: r.ok ? null : r.message, importMs: Math.round(performance.now() - t), slice: r.ok ? r.data.entry.slice : null };
  };
  if (kind === "init") {
    const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
    const log = console.log;
    console.log = () => {};
    await bootstrap();
    console.log = log;
    emit({ done: true });
  } else if (kind === "svgcheck") {
    const [file] = args;
    const { svgProblem } = await import("../src/lib/themes/svg-check.ts");
    const data = readFileSync(file);
    const t = performance.now();
    const reason = svgProblem(data);
    emit({ ms: Math.round(performance.now() - t), reason });
  } else if (kind === "frame") {
    const r = await frame(args[0]);
    emit({ ...r, maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) });
  }
  process.exit(0);
}

/* ================================================================ parent ==== */
const only = process.argv[2] ?? "";
const want = (n) => !only || only === String(n);
const tmp = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-svg-"));
const write = (name, data) => {
  const p = path.join(tmp, name);
  writeFileSync(p, data);
  return p;
};
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">';
const RING = '<path fill-rule="evenodd" fill="#123" d="M0 0H300V300H0Z M30 30V270H270V30Z"/>';
const GOOD = `${HEAD}${RING}</svg>`;

if (want(14)) {
  console.log("\n== #14 : svgProblem en temps linéaire, 512 Ko, UTF-8 (import de thème et cadres)");
  const fill = (unit, bytes) => unit.repeat(Math.floor(bytes / unit.length));
  const traps = {
    "commentaires ouverts après la racine": (b) => HEAD + fill("<!--", b),
    "nom d'attribut sans fin": (b) => `${HEAD.slice(0, -1)} ${fill("a", b)}>`,
    "valeurs sans « = »": (b) => `${HEAD.slice(0, -1)} ${fill("a ", b)}>`,
    "url( sans fin": (b) => `${HEAD}<desc>${fill("url(", b)}</desc></svg>`,
    "url(# sans fin": (b) => `${HEAD}<path fill="${fill("url(#a", b)}"/></svg>`,
    "& sans « ; »": (b) => `${HEAD}<desc>${fill("&", b)}</desc></svg>`,
    "« on » sans « = »": (b) => `${HEAD}<desc>${fill(" on", b)}</desc></svg>`,
    "chevrons ouvrants": (b) => HEAD + fill("<", b),
    "balises <a sans fin": (b) => HEAD + fill("<a", b),
  };
  for (const [label, make] of Object.entries(traps)) {
    const rows = [];
    for (const kb of [125, 250, 500]) {
      // Une taille trop lente arrête la série (la machine reste utilisable) : la suivante serait pire.
      if (rows.some((r) => typeof r.ms !== "number" || r.ms > 8000)) {
        rows.push({ kb, ms: "non mesuré (la taille précédente dépasse déjà 8 s)" });
        continue;
      }
      const file = write("trap.svg", make(kb * 1024));
      const r = runChild(SELF, "svgcheck", [file], { timeoutMs: 25_000 });
      rows.push({ kb, ms: r.timedOut ? ">25000 (tué)" : r.result?.ms });
    }
    const measured = rows.filter((r) => typeof r.ms === "number" || String(r.ms).startsWith(">"));
    const last = measured[measured.length - 1];
    const worst = rows[rows.length - 1].ms;
    const slow = rows.some((r) => typeof r.ms !== "number" ? !String(r.ms).startsWith("non mesuré") : r.ms > 300);
    info(`${label}`, rows.map((r) => `${r.kb} Ko : ${r.ms} ms`).join(" ; "));
    ok(`SB14 SVG piégé de 500 Ko (${label}) analysé en moins de 300 ms`, !slow, `${last?.kb} Ko : ${last?.ms} ms`);
  }
  // Encodage, taille, NUL.
  const sizes = (bytes) => `${HEAD}<desc>${"a".repeat(bytes)}</desc>${RING}</svg>`;
  const check = (name, data) => runChild(SELF, "svgcheck", [write(name, data)], { timeoutMs: 40_000 }).result?.reason ?? null;
  ok("SB14 SVG de 700 Ko refusé (512 Ko au plus)", check("big.svg", sizes(700 * 1024)) !== null);
  for (const enc of ["ISO-8859-1", "windows-1252", "UTF-16", "utf-7"]) {
    ok(`SB14 SVG déclaré en ${enc} refusé`, /encodage/.test(check("enc.svg", `<?xml version="1.0" encoding="${enc}"?>${GOOD}`) ?? ""));
  }
  ok("SB14 octet NUL refusé", check("nul.svg", GOOD.replace("<path", "<path\0")) !== null);
  ok("SB14 SVG UTF-16 avec BOM refusé", check("u16.svg", Buffer.from(`﻿${GOOD}`, "utf16le")) !== null);
  ok("SB14 prologue XML sans fin refusé", check("prolog.svg", `<?xml version="1.0"${" ".repeat(400)}`) !== null);
  // Contournements du nouveau contrôleur (doivent rester refusés).
  const bypass = {
    "« > » dans une valeur d'attribut puis onload": HEAD.replace(">", ` a=">" onload="alert(1)">`) + "</svg>",
    "« > » dans une valeur à apostrophes": `${HEAD}<path d='M0 0>' onload="alert(1)"/></svg>`,
    "href entre apostrophes": `${HEAD}<use href='javascript:alert(1)'/></svg>`,
    "xlink:HREF en majuscules": `${HEAD}<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:HREF="https://x.test/a.svg#b"/></svg>`,
    "href avec retour à la ligne": `${HEAD}<use href\n=\n"https://x.test/a"/></svg>`,
    "javascript: par référence numérique": `${HEAD}<a href="jav&#97;script:alert(1)"/></svg>`,
    "style avec url(http)": `${HEAD}<path style="fill:url(https://x.test/a)"/></svg>`,
    "style avec URL( en majuscules": `${HEAD}<path style="fill:URL(https://x.test/a)"/></svg>`,
    "style avec antislash CSS": `${HEAD}<path style="fill:u\\72l(https://x.test/a)"/></svg>`,
    "CDATA": `${HEAD}<![CDATA[<script>alert(1)</script>]]></svg>`,
    "élément préfixé svg:script": `${HEAD}<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script></svg>`,
    "<script> en majuscules": `${HEAD}<SCRIPT>alert(1)</SCRIPT></svg>`,
    "gestionnaire ONLOAD": `${HEAD.replace("<svg", "<svg ONLOAD='alert(1)'")}</svg>`,
    "gestionnaire collé par « / »": `${HEAD.replace("<svg", "<svg/onload=alert(1)")}</svg>`,
    "texte avec javascript:": `${HEAD}<text>javascript:alert(1)</text></svg>`,
    "DOCTYPE avec entité": `<!DOCTYPE svg [<!ENTITY x "y">]>${GOOD}`,
    "commentaire qui cache un <script>": `${HEAD}<!-- --><script>alert(1)</script></svg>`,
    "racine <svg> en double (fermée puis autre)": `${GOOD}<script>alert(1)</script>`,
    "texte (&) avant la racine": `x${GOOD}`,
  };
  for (const [label, svg] of Object.entries(bypass)) {
    ok(`SB14 contournement refusé : ${label}`, check("bypass.svg", svg) !== null);
  }
  info("variantes qui DOIVENT rester acceptées (régression)", "");
  for (const [label, svg] of Object.entries({
    "SVG simple": GOOD,
    "prologue XML UTF-8 + commentaire": `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Generator -->\n${GOOD}`,
    "texte avec & ordinaire": `${HEAD}<title>Noir & blanc, A&B</title>${RING}</svg>`,
  })) ok(`SB14 accepté : ${label}`, check("good.svg", svg) === null);
}

if (want(3)) {
  console.log("\n== #3 : cadres SVG (importFrame) : détection en temps linéaire et liste blanche avant / après svgo");
  const data = freshData(SELF);
  const frameOf = (name, content, timeoutMs = 25_000) => runChild(SELF, "frame", [write(name, content)], { timeoutMs, data });
  // 1. looksSvg : « <!---->» répété, puis autre chose qu'un SVG.
  const ms = [];
  for (const n of [16, 20, 22, 24, 26, 28, 290]) {
    const r = frameOf("redos.svg", "<!---->".repeat(n) + "<html>");
    const t = r.result?.importMs;
    ms.push(`${n} : ${r.timedOut ? ">25000 (tué)" : t + " ms"}`);
    ok(`SB3 looksSvg sur ${n} commentaires vides (puis <html>) : importFrame répond en moins de 500 ms`, !r.timedOut && typeof t === "number" && t < 500, r.timedOut ? "processus tué après 25 s" : `${t} ms (processus entier ${r.ms} ms)`);
  }
  info("croissance de importFrame (durée de l'appel seul, démarrage exclu)", ms.join(" ; "));
  // 2. SVG hostiles : tous refusés avec le message de la liste blanche.
  const hostile = {
    "DOCTYPE et entité": `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>${GOOD.replace("</svg>", "<text>&x;</text></svg>")}`,
    "<set> réécrit href": GOOD.replace("</svg>", '<a><set attributeName="href" to="javascript:alert(1)"/></a></svg>'),
    "<animate>": GOOD.replace("</svg>", '<animate attributeName="fill" values="red;blue" dur="1s"/></svg>'),
    "<animateTransform>": GOOD.replace("</svg>", '<animateTransform attributeName="transform" type="rotate" to="360" dur="1s"/></svg>'),
    "href='javascript:' (apostrophes)": GOOD.replace("<path", "<a href='javascript:alert(1)'><path").replace("</svg>", "</a></svg>"),
    "xlink:href='javascript:'": GOOD.replace("<svg ", '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ').replace("</svg>", "<use xlink:href='javascript:alert(1)'/></svg>"),
    "href sans guillemets": GOOD.replace("</svg>", "<use href=https://x.test/a.svg#b/></svg>"),
    "<style> avec url(https)": GOOD.replace("</svg>", "<style>path{fill:url(https://x.test/a)}</style></svg>"),
    "<style> avec @import": GOOD.replace("</svg>", "<style>@import 'https://x.test/a.css';</style></svg>"),
    "attribut style avec url(//)": GOOD.replace("<path", '<path style="fill:url(//x.test/a)"'),
    "<script>": GOOD.replace("</svg>", "<script>alert(1)</script></svg>"),
    "gestionnaire onload": GOOD.replace("<svg ", '<svg onload="alert(1)" '),
    "gestionnaire onclick entre apostrophes": GOOD.replace("<path", "<path onclick='alert(1)'"),
    "<foreignObject>": GOOD.replace("</svg>", "<foreignObject><div/></foreignObject></svg>"),
    "<image> externe": GOOD.replace("</svg>", '<image href="https://x.test/a.png"/></svg>'),
    "<image> data:": GOOD.replace("</svg>", '<image href="data:image/png;base64,AAAA"/></svg>'),
    "<iframe>": GOOD.replace("</svg>", "<iframe src='https://x.test'/></svg>"),
  };
  for (const [label, svg] of Object.entries(hostile)) {
    const r = frameOf("hostile.svg", svg).result;
    ok(`SB3 SVG de cadre refusé : ${label}`, r && r.ok === false, r ? `${r.ok ? "ACCEPTÉ" : r.message?.slice(0, 70)}` : "pas de résultat");
  }
  // 3. Légitimes (régression) et cas d'effet de bord.
  const legit = {
    "cadre simple (celui de l'e2e lot 74)": GOOD,
    "prologue XML + commentaire Illustrator": `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Adobe Illustrator 27 -->\n${GOOD}`,
  };
  for (const [label, svg] of Object.entries(legit)) {
    const r = frameOf("legit.svg", svg).result;
    ok(`SB3 cadre légitime accepté : ${label}`, r?.ok === true, r?.message ?? "");
  }
  for (const [label, svg] of Object.entries({
    "DOCTYPE Illustrator ancien (sans sous-ensemble)": `<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${GOOD}`,
    "Illustrator « CSS interne » (<style> + classes)": `${HEAD}<defs><style>.a{fill:#123;fill-rule:evenodd}</style></defs><path class="a" d="M0 0H300V300H0Z M30 30V270H270V30Z"/></svg>`,
    "Inkscape (sodipodi:namedview + metadata)": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 300 300"><sodipodi:namedview id="base" pagecolor="#fff"/><metadata id="m"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata>${RING}</svg>`,
    "SVG de 600 Ko (ornement détaillé)": `${HEAD}<desc>${"a".repeat(600 * 1024)}</desc>${RING}</svg>`,
    "ombre portée <feDropShadow> / <feMorphology>": `${HEAD}<defs><filter id="f"><feMorphology operator="dilate" radius="1"/></filter></defs>${RING}</svg>`,
  })) {
    const r = frameOf("effet.svg", svg).result;
    info(`effet de bord, ${label}`, r ? (r.ok ? "accepté" : `REFUSÉ : ${r.message?.slice(0, 110)}`) : "pas de résultat");
  }
}

if (want(18)) {
  console.log("\n== #18 : import de cadres, rendus sharp bornés dans la requête");
  const data = freshData(SELF);
  const frameOf = (name, content, opts = {}) => runChild(SELF, "frame", [write(name, content)], { timeoutMs: opts.timeoutMs ?? 90_000, data, env: opts.env });
  const S = 4096;
  const heavySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"><defs><filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.002" numOctaves="10" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="200"/><feGaussianBlur stdDeviation="30"/></filter></defs><path filter="url(#f)" fill-rule="evenodd" fill="#123" d="M0 0H${S}V${S}H0Z M300 300V${S - 300}H${S - 300}V300Z"/></svg>`;
  const plain = (s, t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}"><path fill-rule="evenodd" fill="#123" d="M0 0H${s}V${s}H0Z M${t} ${t}V${s - t}H${s - t}V${t}Z"/></svg>`;
  const plainBig = frameOf("plain4096.svg", plain(S, 300));
  info("cadre SVG simple 4096 px", `${plainBig.ms} ms, pic mémoire ${plainBig.result?.maxRssMb} Mo, bord ${JSON.stringify(plainBig.result?.slice)}`);
  ok("SB18 cadre SVG simple de 4096 px : pic mémoire du processus sous 900 Mo (rendu à 1200 px, pas 8192 px)", plainBig.result?.ok === true && plainBig.result.maxRssMb < 900, `${plainBig.result?.maxRssMb} Mo`);
  ok("SB18 bord du cadre 4096 px retrouvé à ±1 px (300)", plainBig.result?.slice?.every((s) => Math.abs(s - 300) <= 1) === true, JSON.stringify(plainBig.result?.slice));
  const heavy = frameOf("heavy.svg", heavySvg, { timeoutMs: 60_000 });
  info("SVG à filtre lourd 4096 px (feTurbulence 10 octaves + déplacement + flou)", heavy.timedOut ? "tué après 60 s" : `${heavy.ms} ms, pic ${heavy.result?.maxRssMb} Mo, ${heavy.result?.ok ? "accepté" : heavy.result?.message}`);
  ok("SB18 SVG à filtre lourd : traité (ou refusé) en moins de 30 s, pic mémoire sous 1,5 Go", !heavy.timedOut && heavy.ms < 30_000 && (heavy.result?.maxRssMb ?? 1e9) < 1500, heavy.timedOut ? "tué à 60 s" : `${heavy.ms} ms, ${heavy.result?.maxRssMb} Mo`);
  // Bitmap > 40 Mpx (PNG tronqué : en-tête puis quelques octets).
  const chunk = (type, d) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(type), d]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10000, 0);
  ihdr.writeUInt32BE(5000, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const huge = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(64))), chunk("IEND", Buffer.alloc(0))]);
  const h = frameOf("huge.png", huge);
  ok("SB18 PNG de 50 Mpx refusé sans décodage (< 3 s, < 400 Mo)", h.result?.ok === false && h.ms < 3000 && h.result.maxRssMb < 400, `${h.ms} ms, ${h.result?.maxRssMb} Mo, ${h.result?.message?.slice(0, 60)}`);
  // Budget de décodage : WebP sans perte 4000×4000 avec budget abaissé à 50 Mo.
  const sharp = (await import("sharp")).default;
  const webp = await sharp(Buffer.alloc(4000 * 4000 * 4, 0), { raw: { width: 4000, height: 4000, channels: 4 } }).webp({ lossless: true }).toBuffer();
  const w = frameOf("lourd.webp", webp, { env: { IMAGE_DECODE_BUDGET_MB: "50" } });
  ok("SB18 WebP 16 Mpx au-delà du budget de décodage (50 Mo) refusé avant d'ouvrir", w.result?.ok === false && /trop lourde à ouvrir/.test(w.result.message ?? ""), w.result?.ok ? `accepté, pic ${w.result.maxRssMb} Mo` : w.result?.message?.slice(0, 70));
  // Cadre PNG ordinaire (régression).
  const wpx = 400;
  const px = Buffer.alloc(wpx * wpx * 4);
  for (let y = 0; y < wpx; y++) for (let x = 0; x < wpx; x++) if (x < 40 || y < 40 || x >= wpx - 40 || y >= wpx - 40) px.set([200, 30, 30, 255], (y * wpx + x) * 4);
  const png = await sharp(px, { raw: { width: wpx, height: wpx, channels: 4 } }).png().toBuffer();
  const okp = frameOf("cadre.png", png);
  ok("SB18 cadre PNG ordinaire accepté, bord de 40 px retrouvé", okp.result?.ok === true && okp.result.slice.every((s) => s === 40), JSON.stringify(okp.result?.slice));
  // PNG 4000x4000 légitime (régression de seuil)
  const big = await sharp({ create: { width: 4000, height: 4000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const okbig = frameOf("grand.png", big);
  ok("SB18 PNG 4000 × 4000 (16 Mpx) toujours accepté", okbig.result?.ok === true, okbig.result?.message ?? `${okbig.ms} ms`);
}

finish();
