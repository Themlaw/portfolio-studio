/**
 * pdfinfo et pdftoppm (poppler-utils, paquet Debian), lancés de façon
 * défensive, comme ffmpeg et l'enfant du kit :
 *  - arguments en tableau, jamais de shell ; fichier d'entrée par chemin
 *    ABSOLU (jamais pris pour une option), aucune URL ;
 *  - priorité basse (`nice -n 10` au lancement), environnement minimal (aucun
 *    secret), fontconfig sans police système (public/kit/pdf-fonts.conf : une
 *    police non embarquée est remplacée, jamais cherchée ailleurs) ;
 *  - délai dur et plafond de mémoire résidente (lu dans /proc toutes les
 *    100 ms, SIGKILL au-delà), sortie bornée, priorité OOM maximale (le noyau
 *    tue le rendu, jamais le serveur).
 * Poppler n'a pas de moteur JavaScript : les scripts et actions d'un PDF ne
 * sont jamais exécutés ; il ne lit que le fichier (pas de réseau).
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parsePdfInfo, pdfInfoArgs, pdfLimits, pdfToPpmArgs } from "./limits";

const MAX_OUTPUT = 64 * 1024;

export class PdfToolError extends Error {
  constructor(
    readonly reason: "temps" | "mémoire" | "échec",
    message: string,
  ) {
    super(message);
  }
}

function rssMb(pid: number): number | null {
  try {
    const kb = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1];
    return kb ? Number(kb) / 1024 : null;
  } catch {
    return null;
  }
}

export type ToolRun = { stdout: string; peakMb: number; ms: number };

/** Lance un outil de poppler (liste blanche) et attend sa fin, bornée en temps et en mémoire. */
export function runPoppler(tool: "pdfinfo" | "pdftoppm", args: string[], timeoutMs: number): Promise<ToolRun> {
  const limits = pdfLimits();
  const maxRssMb = tool === "pdfinfo" ? limits.infoRssMb : limits.maxRssMb;
  const input = tool === "pdfinfo" ? args[args.length - 1] : args[args.length - 2];
  if (!input || !path.isAbsolute(input)) return Promise.reject(new PdfToolError("échec", `${tool} : chemin d'entrée non absolu`));
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("nice", ["-n", "10", tool, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        FONTCONFIG_FILE: path.join(/* turbopackIgnore: true */ process.cwd(), "public/kit/pdf-fonts.conf"),
        XDG_CACHE_HOME: "/tmp",
        HOME: "/tmp",
        LANG: "C.UTF-8",
      },
    });
    try {
      if (child.pid) writeFileSync(`/proc/${child.pid}/oom_score_adj`, "1000");
    } catch {
      // non permis ou hors Linux
    }
    let out = "";
    let err = "";
    let killed: "temps" | "mémoire" | "sortie" | null = null;
    let peak = 0;
    const kill = (why: "temps" | "mémoire" | "sortie") => {
      killed ??= why;
      child.kill("SIGKILL");
    };
    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > MAX_OUTPUT) kill("sortie");
    });
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => kill("temps"), timeoutMs);
    const watch = setInterval(() => {
      const mb = child.pid ? rssMb(child.pid) : null;
      if (mb === null) return;
      peak = Math.max(peak, mb);
      if (mb > maxRssMb) kill("mémoire");
    }, 100);
    child.on("error", (e) => {
      clearTimeout(timer);
      clearInterval(watch);
      reject(new PdfToolError("échec", `${tool} : ${e.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearInterval(watch);
      const ms = Date.now() - started;
      if (killed === "temps") return reject(new PdfToolError("temps", `${tool} : trop de temps (${ms} ms)`));
      if (killed === "mémoire") return reject(new PdfToolError("mémoire", `${tool} : mémoire dépassée (${Math.round(peak)} Mo, plafond ${maxRssMb} Mo)`));
      if (killed === "sortie") return reject(new PdfToolError("échec", `${tool} : sortie trop longue`));
      // Tué par le noyau (OOM du conteneur) ou par un signal venu d'ailleurs.
      if (signal) return reject(new PdfToolError("mémoire", `${tool} : arrêté (${signal})`));
      if (code !== 0) return reject(new PdfToolError("échec", `${tool} : code ${code} ${err.trim().split("\n").pop() ?? ""}`));
      resolve({ stdout: out, peakMb: Math.round(peak), ms });
    });
  });
}

/** Structure d'un PDF : pages, chiffrement, taille de la première page (points). */
export async function pdfInfo(file: string) {
  const run = await runPoppler("pdfinfo", pdfInfoArgs(file), pdfLimits().infoMs);
  const info = parsePdfInfo(run.stdout);
  if (!info) throw new PdfToolError("échec", "pdfinfo : sortie illisible");
  return { ...info, peakMb: run.peakMb, ms: run.ms };
}

/** Rend les pages 1 à `pages` en PNG (`<outPrefix>-<n>.png`, n éventuellement complété de zéros). */
export function renderPdf(file: string, outPrefix: string, pages: number) {
  const { renderPx, renderMs } = pdfLimits();
  return runPoppler("pdftoppm", pdfToPpmArgs(file, outPrefix, pages, renderPx), renderMs);
}
