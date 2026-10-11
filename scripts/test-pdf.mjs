#!/usr/bin/env node
/**
 * PDF du bloc CV : règles pures (signature, nom de fichier téléchargé,
 * lecture de pdfinfo, clés servies), lancement défensif de poppler (analyse
 * statique), puis — si poppler-utils est installé — pdfinfo / pdftoppm sur
 * des PDF légitimes et hostiles (JavaScript, bombe de décompression, page
 * géante, flux externe, trop de pages), délai et mémoire bornés.
 * Usage : node --import tsx scripts/test-pdf.mjs   (npm test)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { externalStreamPdf, imageBombPdf, scriptedPdf, textPdf } from "./lib/pdf-fixtures.mjs";

const limits = await import(new URL("../src/lib/pdf/limits.ts", import.meta.url));
const sniff = await import(new URL("../src/lib/upload/sniff.ts", import.meta.url));
const variants = await import(new URL("../src/lib/images/variants.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};
const bytes = (s) => new Uint8Array(Buffer.from(s, "latin1"));

// ---- Signature ----------------------------------------------------------------------
ok("signature : %PDF-1.7 accepté", sniff.sniffPdf(bytes("%PDF-1.7\n%âãÏÓ")) && limits.isPdfHead(bytes("%PDF-1.7\n")));
ok("signature : %PDF-2.0 accepté", sniff.sniffPdf(bytes("%PDF-2.0\n")));
ok("signature : octets devant l'en-tête refusés (polyglotte)", !sniff.sniffPdf(bytes("\n%PDF-1.4\n")) && !sniff.sniffPdf(bytes("<html>%PDF-1.4")));
ok("signature : PK (zip) / HTML / vide refusés", !sniff.sniffPdf(bytes("PK\x03\x04....")) && !sniff.sniffPdf(bytes("<!doctype html>")) && !sniff.sniffPdf(new Uint8Array()));
ok("signature : %PDF-9 / %PDF- seul refusés", !sniff.sniffPdf(bytes("%PDF-9.1\n")) && !sniff.sniffPdf(bytes("%PDF-\n\n\n")));
ok("un PDF n'est ni une image ni une vidéo", !sniff.sniffImage(bytes("%PDF-1.4\n%âãÏÓ")) && !sniff.sniffVideo(bytes("%PDF-1.4\n%âãÏÓ")));

// ---- Nom du fichier téléchargé --------------------------------------------------------
ok("nom : vide → cv", limits.downloadName("") === "cv" && limits.downloadName(undefined) === "cv");
ok("nom : accents et espaces", limits.downloadName("CV Camille Hélène") === "cv-camille-helene");
ok("nom : chemin et guillemets neutralisés", limits.downloadName('../../etc/passwd"; x=') === "etc-passwd-x");
ok("nom : retour à la ligne (injection d'en-tête) neutralisé", /^attachment; filename="[a-z0-9-]+\.pdf"$/.test(limits.attachmentHeader('a"\r\nSet-Cookie: x=1')), limits.attachmentHeader('a"\r\nSet-Cookie: x=1'));
ok("nom : 60 caractères au plus", limits.downloadName("a".repeat(200)).length === 60);
ok("en-tête : attachment + .pdf", limits.attachmentHeader("Mon CV") === 'attachment; filename="mon-cv.pdf"');

// ---- pdfinfo ------------------------------------------------------------------------------
const info = limits.parsePdfInfo("Producer: x\nPages:           3\nEncrypted:       no\nPage size:       595.276 x 841.89 pts (A4)\nPage rot:        0\n");
ok("pdfinfo : pages, chiffrement, taille", info?.pages === 3 && info.encrypted === false && Math.round(info.width) === 595);
const rot = limits.parsePdfInfo("Pages: 1\nEncrypted: yes (print:no)\nPage size: 595 x 842 pts (A4)\nPage rot: 90\n");
ok("pdfinfo : page tournée (90°) et chiffré", rot?.width === 842 && rot.height === 595 && rot.encrypted === true);
ok("pdfinfo : sortie illisible → null", limits.parsePdfInfo("Syntax Error") === null);
const r = limits.renderedSize(595, 842, 1600);
ok("rendu : plus grand côté borné", r.height === 1600 && r.width === 1131, JSON.stringify(r));
ok("rendu : page géante bornée aussi", Math.max(...Object.values(limits.renderedSize(14400, 14400, 1600))) === 1600);

// ---- Clés servies -----------------------------------------------------------------------
const h = "0123456789abcdef";
ok("clés : document et pages reconnues", variants.hashOfVariantKey(limits.pdfKey(h)) === h && variants.hashOfVariantKey(limits.pageKey(h, 3, 1600, "webp")) === h);
ok("clés : rien d'autre sous doc/", [`doc/${h}/x.pdf`, `doc/${h}/../originals/a.pdf`, `doc/${h}/p1-1600.png`, `doc/${h}/document.pdf.html`].every((k) => variants.hashOfVariantKey(k) === null));
ok("type : .pdf → application/pdf", variants.variantMime(limits.pdfKey(h)) === "application/pdf");

// ---- Lancement de poppler (analyse statique) ----------------------------------------------------
const poppler = readFileSync(new URL("../src/lib/pdf/poppler.ts", import.meta.url), "utf8");
ok("poppler.ts : spawn(\"nice\", [\"-n\", \"10\", outil, …])", /spawn\("nice", \["-n", "10", tool, \.\.\.args\]/.test(poppler));
ok("poppler.ts : spawn seul, sans shell", /import \{ spawn \} from "node:child_process"/.test(poppler) && !/shell:\s*true|execSync|execFile|child_process\.exec/.test(poppler));
ok("poppler.ts : outils en liste blanche (pdfinfo | pdftoppm)", /tool: "pdfinfo" \| "pdftoppm"/.test(poppler));
ok("poppler.ts : environnement minimal (pas de ...process.env)", !/\.\.\.process\.env/.test(poppler) && /FONTCONFIG_FILE/.test(poppler));
ok("poppler.ts : délai dur, plafond mémoire, OOM d'abord", /setTimeout\(\(\) => kill\("temps"\)/.test(poppler) && /mb > maxRssMb/.test(poppler) && /oom_score_adj/.test(poppler));
ok("pdfinfo : plafond mémoire propre, bas (64 Mo par défaut), choisi pour pdfinfo seulement", /tool === "pdfinfo" \? limits\.infoRssMb : limits\.maxRssMb/.test(poppler) && /PDF_INFO_MAX_RSS_MB", 64\)/.test(readFileSync(new URL("../src/lib/pdf/limits.ts", import.meta.url), "utf8")));
ok("poppler.ts : chemin d'entrée absolu exigé", /path\.isAbsolute\(input\)/.test(poppler));
const args = limits.pdfToPpmArgs("/data/x.pdf", "/data/tmp/p", 2, 1600);
ok("pdftoppm : -scale-to borné, pages 1..n, fichier en avant-dernier", args.join(" ") === "-q -png -f 1 -l 2 -scale-to 1600 /data/x.pdf /data/tmp/p");

// ---- Poppler réel (si installé) -------------------------------------------------------------------
let installed = true;
try {
  execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
} catch {
  installed = false;
}
if (!installed) {
  console.log("SKIP  poppler-utils absent : tests de rendu réels ignorés (apt install poppler-utils)");
} else {
  const { pdfInfo, renderPdf } = await import(new URL("../src/lib/pdf/poppler.ts", import.meta.url));
  const dir = mkdtempSync(path.join(tmpdir(), "test-pdf-"));
  const put = (name, buf) => {
    const f = path.join(dir, name);
    writeFileSync(f, buf);
    return f;
  };
  const time = async (fn) => {
    const t = Date.now();
    try {
      return { value: await fn(), ms: Date.now() - t };
    } catch (error) {
      return { error, ms: Date.now() - t };
    }
  };
  try {
    // Légitime : 2 pages.
    const cv = put("cv.pdf", textPdf(2));
    const i1 = await pdfInfo(cv);
    ok("réel : pdfinfo (2 pages A4)", i1.pages === 2 && !i1.encrypted && i1.width === 595, JSON.stringify(i1));
    const out1 = path.join(dir, "cv");
    const run1 = await renderPdf(cv, out1, 2);
    const pngs = readdirSync(dir).filter((n) => /^cv-\d+\.png$/.test(n));
    const dims = pngs.map((n) => execFileSync("file", [path.join(dir, n)]).toString());
    ok("réel : 2 pages rendues en PNG, 1600 px de haut", pngs.length === 2 && dims.every((d) => /1131 x 1600/.test(d)), dims.join(" | "));
    console.log(`      rendu 2 pages : ${run1.ms} ms, pic ${run1.peakMb} Mo`);

    // Trop de pages : lu, et refusé par la règle (11 > 10).
    const many = await pdfInfo(put("many.pdf", textPdf(11)));
    ok("réel : 11 pages détectées (refus à l'envoi : > 10)", many.pages === 11 && many.pages > limits.pdfLimits().maxPages);

    // JavaScript : rendu normal, rien n'est exécuté (poppler n'a pas de moteur JS).
    const js = put("js.pdf", scriptedPdf());
    const runJs = await time(() => renderPdf(js, path.join(dir, "js"), 1));
    ok("réel : PDF avec JavaScript (OpenAction, Names) rendu sans exécution", !runJs.error && readdirSync(dir).some((n) => /^js-\d+\.png$/.test(n)), String(runJs.error ?? ""));

    // Page géante (200 × 200 pouces, le maximum de la norme) : sortie bornée à 1600 px.
    const huge = put("huge.pdf", textPdf(1, { mediaBox: "0 0 14400 14400" }));
    const runHuge = await time(() => renderPdf(huge, path.join(dir, "huge"), 1));
    const hugeDim = readdirSync(dir).filter((n) => /^huge-\d+\.png$/.test(n)).map((n) => execFileSync("file", [path.join(dir, n)]).toString());
    ok("réel : page géante → 1600 × 1600 px au plus", !runHuge.error && hugeDim.length === 1 && /1600 x 1600/.test(hugeDim[0]), String(runHuge.error ?? hugeDim));

    // Flux externe (/F) : poppler ne lit rien hors du PDF (strace si disponible).
    const ext = put("ext.pdf", externalStreamPdf("/etc/hostname"));
    let strace = true;
    try {
      execFileSync("strace", ["-V"], { stdio: "ignore" });
    } catch {
      strace = false;
    }
    if (strace) {
      // strace écrit sur stderr : execFileSync ne rend que stdout (null ici).
      const trace = spawnSync("strace", ["-f", "-e", "trace=openat,open", "pdftoppm", "-q", "-png", "-scale-to", "200", ext, path.join(dir, "ext")], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" }).stderr ?? "";
      ok("réel : flux externe (/F /etc/hostname) jamais ouvert", !/\/etc\/hostname/.test(trace));
    } else {
      const runExt = await time(() => renderPdf(ext, path.join(dir, "ext"), 1));
      ok("réel : flux externe (/F) sans plantage (strace absent : ouverture non vérifiée)", !runExt.error || runExt.error.reason === "échec");
    }

    // Bombe de décompression : 900 Mo décodés pour ~1 Mo envoyé. Plafond abaissé à 200 Mo
    // pour le test : le rendu est tué (mémoire) ou échoue, toujours borné dans le temps.
    const bombBuf = await imageBombPdf(30000);
    console.log(`      bombe : ${(bombBuf.length / 1024 / 1024).toFixed(2)} Mo sur disque, 900 Mo décodés`);
    const bomb = put("bomb.pdf", bombBuf);
    process.env.PDF_MAX_RSS_MB = "200";
    process.env.PDF_RENDER_MAX_DURATION_S = "30";
    const runBomb = await time(() => renderPdf(bomb, path.join(dir, "bomb"), 1));
    delete process.env.PDF_MAX_RSS_MB;
    delete process.env.PDF_RENDER_MAX_DURATION_S;
    if (runBomb.error) {
      ok("réel : bombe de décompression arrêtée (mémoire / temps) ou refusée", ["mémoire", "temps", "échec"].includes(runBomb.error.reason), String(runBomb.error));
      console.log(`      bombe : ${runBomb.error.reason} en ${runBomb.ms} ms — ${runBomb.error.message}`);
    } else {
      // poppler réduit l'image à la volée : rendu sous le plafond, en temps borné.
      ok("réel : bombe rendue SOUS le plafond mémoire (200 Mo) et en moins de 30 s", runBomb.value.peakMb < 200 && runBomb.ms < 30000, JSON.stringify(runBomb.value));
      console.log(`      bombe : rendue en ${runBomb.ms} ms, pic ${runBomb.value.peakMb} Mo`);
    }

    // Délai dur : une limite de 1 ms tue le rendu.
    process.env.PDF_RENDER_MAX_DURATION_S = "0.001";
    const runSlow = await time(() => renderPdf(cv, path.join(dir, "slow"), 2));
    delete process.env.PDF_RENDER_MAX_DURATION_S;
    ok("réel : délai dépassé → processus tué (« temps »)", runSlow.error?.reason === "temps", String(runSlow.error));

    // Fichier abîmé.
    const broken = put("broken.pdf", Buffer.from("%PDF-1.4\nceci n'est pas un pdf\n", "latin1"));
    const runBroken = await time(() => pdfInfo(broken));
    ok("réel : PDF abîmé → erreur lisible", Boolean(runBroken.error));

    // Chemin relatif : refusé avant tout lancement (jamais pris pour une option).
    const runRel = await time(() => pdfInfo("-opw"));
    ok("réel : chemin non absolu refusé", runRel.error?.message?.includes("non absolu"), String(runRel.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} échec(s)` : "\ntest-pdf : OK");
process.exit(failures ? 1 : 0);
