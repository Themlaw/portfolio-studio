/**
 * Conversion d'une vidéo (worker vidéo, un job à la fois) :
 *  - 1080.mp4 si le petit côté de la source atteint 1080, et 720.mp4 (sans
 *    agrandir) : H.264 High, CRF 22, preset medium, yuv420p, +faststart,
 *    AAC 128k (ou sans audio), rotation appliquée, aucune métadonnée ;
 *  - poster.webp à ~10 % de la durée, en 960 / 1600 / pleine taille.
 *
 * ffmpeg est lancé de façon défensive : arguments en tableau (jamais de
 * shell), -nostdin, protocole « file » seul, format d'entrée forcé (liste
 * blanche), décodage sur un fil et encodage sur deux (-threads 2), une sortie
 * par processus, lookahead réduit, priorité basse, délai dur (SIGKILL). Le pic
 * mémoire et le temps CPU de ffmpeg sont relevés (journal du worker).
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { dataDir } from "@/lib/db";
import type { VariantFile } from "@/lib/images/variants";
import { getStorage } from "@/lib/storage";

import { decoderFor, isAllowedAudio, isAllowedVideo, videoLimits } from "./limits";
import { runProbe } from "./probe";

export type TranscodeResult = { files: VariantFile[]; duration: number; width: number; height: number; hasAudio: boolean; posterColor: string | null };
export type FfmpegStats = { peakRssMb: number; cpuSeconds: number; wallSeconds: number };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** Plus grande allocation unique permise à ffmpeg (une image 4K tient en ~12 Mo). */
export const MAX_ALLOC = 256 * 1024 * 1024;
const CLK = 100; // ticks par seconde (/proc/<pid>/stat), Linux

/** Lit le pic mémoire (VmHWM) et le temps CPU d'un processus en cours. */
async function sampleProc(pid: number): Promise<{ hwmMb: number; cpu: number } | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const statLine = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = statLine.slice(statLine.lastIndexOf(")") + 2).split(" ");
    const cpu = (Number(fields[11]) + Number(fields[12])) / CLK;
    const hwm = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
    return { hwmMb: Math.round(hwm), cpu };
  } catch {
    return null;
  }
}

/** Lance ffmpeg (arguments en tableau) ; progression via -progress pipe:1. */
function runFfmpeg(args: string[], opts: { timeoutMs: number; durationS?: number; onProgress?: (p: number) => void }): Promise<FfmpegStats> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    // nice dès le lancement : tous les fils de ffmpeg héritent de la priorité basse.
    const child = spawn("nice", ["-n", "10", "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-max_alloc", String(MAX_ALLOC), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    let peak = 0;
    let cpu = 0;
    const sampler = setInterval(async () => {
      if (!child.pid) return;
      const s = await sampleProc(child.pid);
      if (s) {
        peak = Math.max(peak, s.hwmMb);
        cpu = s.cpu;
      }
    }, 500);
    let err = "";
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m && opts.durationS && opts.onProgress) opts.onProgress(Math.min(99, Math.floor(Number(m[1]) / 1e6 / opts.durationS * 100)));
      }
    });
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      clearInterval(sampler);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearInterval(sampler);
      if (signal === "SIGKILL" && timedOut) return reject(new Error("conversion : trop de temps"));
      // Arrêt brutal sans notre minuteur : en pratique l'OOM killer.
      if (signal === "SIGKILL") return reject(new Error("conversion : mémoire insuffisante"));
      if (code !== 0) return reject(new Error(`ffmpeg : ${err.trim().split("\n").pop() ?? code}`));
      resolve({ peakRssMb: peak, cpuSeconds: Math.round(cpu * 10) / 10, wallSeconds: Math.round((Date.now() - started) / 100) / 10 });
    });
  });
}

/** Paramètres H.264/AAC communs (aucune métadonnée, sortie déterministe). */
function encodeArgs(hasAudio: boolean): string[] {
  return [
    "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : ["-an"]),
    "-sn", "-dn",
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
    "-movflags", "+faststart",
  ];
}

export async function transcodeVideo(
  input: { file: string; container: "mov" | "matroska"; hash16: string; jobId: number },
  onProgress: (percent: number) => void,
): Promise<{ result: TranscodeResult; stats: FfmpegStats }> {
  const limits = videoLimits();
  const probe = await runProbe(input.file, input.container);
  if (!isAllowedVideo(probe.videoCodec) || (probe.audioCodec && !isAllowedAudio(probe.audioCodec))) {
    throw new Error(`codec non pris en charge (${probe.videoCodec}/${probe.audioCodec})`);
  }
  const work = path.join(dataDir(), "tmp", `video-${input.jobId}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  const deadline = Date.now() + limits.jobMaxMs;
  const left = () => Math.max(1000, deadline - Date.now());
  try {
    const short = Math.min(probe.width, probe.height);
    const landscape = probe.width >= probe.height;
    // Hauteurs cibles (petit côté), jamais au-delà de la source.
    const targets = [...new Set([short >= 1080 ? 1080 : null, Math.min(720, short)].filter((v): v is number => v !== null))].map(even);
    const outputs = targets.map((t) => ({ t, file: path.join(work, `${t === 1080 ? 1080 : 720}.mp4`) }));
    // Une sortie par processus, l'une après l'autre : le pic mémoire est celui
    // d'un seul encodeur (mesuré : 4K → 1080p ≈ 420 Mo, contre 1 Go pour deux
    // sorties dans le même processus). La progression est pondérée par pixels.
    const weight = outputs.map((o) => o.t * o.t);
    const total = weight.reduce((a, b) => a + b, 0);
    let done = 0;
    let stats: FfmpegStats = { peakRssMb: 0, cpuSeconds: 0, wallSeconds: 0 };
    for (const [i, o] of outputs.entries()) {
      const base = done;
      const args = [
        "-threads", "1", // décodage sur un fil : moins d'images en mémoire
        ...decoderArgs(probe),
        "-protocol_whitelist", "file", "-f", input.container, "-i", "file:" + input.file,
        "-filter_threads", "1",
        "-map", "0:v:0", ...(probe.hasAudio ? ["-map", "0:a:0"] : []),
        "-vf", scale(o.t, landscape),
        "-threads", "2",
        "-x264-params", "rc-lookahead=10:sync-lookahead=0:lookahead-threads=1",
        ...encodeArgs(probe.hasAudio),
        "-progress", "pipe:1", "-nostats",
        "file:" + o.file,
      ];
      const one = await runFfmpeg(args, {
        timeoutMs: left(),
        durationS: probe.duration,
        onProgress: (p) => onProgress(Math.min(99, Math.floor(base + (p * weight[i]) / total))),
      });
      done += (100 * weight[i]) / total;
      stats = { peakRssMb: Math.max(stats.peakRssMb, one.peakRssMb), cpuSeconds: Math.round((stats.cpuSeconds + one.cpuSeconds) * 10) / 10, wallSeconds: Math.round((stats.wallSeconds + one.wallSeconds) * 10) / 10 };
    }

    // Validation des sorties avant tout enregistrement.
    const storage = getStorage();
    const files: VariantFile[] = [];
    try {
    let dims = { w: probe.width, h: probe.height };
    for (const o of outputs) {
      const p = await runProbe(o.file, "mov");
      if (p.duration <= 0 || !p.width) throw new Error("sortie vidéo invalide");
      if (o === outputs[outputs.length - 1] || outputs.length === 1) dims = { w: p.width, h: p.height };
      const key = `vid/${input.hash16}/${o.t === 1080 ? 1080 : 720}.mp4`;
      const stored = await storage.put(key, createReadStream(o.file));
      files.push({ key, w: p.width, h: p.height, format: "mp4", size: stored.size });
    }
    void dims;

    // Poster : une image vers 10 % de la durée, prise sur la plus grande sortie.
    const posterPng = path.join(work, "poster.png");
    const at = Math.max(0, Math.min(probe.duration * 0.1, probe.duration - 0.1));
    await runFfmpeg(
      ["-threads", "1", "-c:v", "h264", "-protocol_whitelist", "file", "-ss", at.toFixed(2), "-f", "mov", "-i", "file:" + outputs[0].file, "-frames:v", "1", "-map_metadata", "-1", "-f", "image2", "-c:v", "png", "file:" + posterPng],
      { timeoutMs: Math.min(left(), 60_000) },
    );
    const meta = await sharp(posterPng).metadata();
    const stats2 = await sharp(posterPng).stats();
    const d = stats2.dominant;
    const posterColor = `#${[d.r, d.g, d.b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
    const long = Math.max(meta.width ?? 0, meta.height ?? 0);
    const boxes = [...new Set([960, 1600, long].filter((b) => b <= long))].sort((a, b) => a - b);
    for (const box of boxes) {
      const { data, info } = await sharp(posterPng).resize({ width: box, height: box, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      const key = `vid/${input.hash16}/poster-${box === long ? "full" : box}.webp`;
      const stored = await storage.put(key, (await import("node:stream")).Readable.from(data));
      files.push({ key, w: info.width, h: info.height, format: "webp", size: stored.size });
    }
    const main = files.find((f) => f.format === "mp4" && f.key.endsWith("/720.mp4")) ?? files[0];
    onProgress(100);
    return {
      result: { files, duration: probe.duration, width: main.w, height: main.h, hasAudio: probe.hasAudio, posterColor },
      stats,
    };
    } catch (error) {
      // Échec après des écritures (poster, validation) : aucune sortie orpheline.
      for (const f of files) await storage.delete(f.key).catch(() => {});
      throw error;
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Décodeurs forcés (avant -i) : seuls ceux de la liste blanche servent. */
export function decoderArgs(probe: { videoCodec: string; audioCodec: string | null; hasAudio: boolean }): string[] {
  return ["-c:v", decoderFor(probe.videoCodec), ...(probe.hasAudio && probe.audioCodec ? ["-c:a", decoderFor(probe.audioCodec)] : [])];
}

function scale(target: number, landscape: boolean): string {
  // Petit côté = target ; l'autre côté pair, proportions gardées.
  return landscape ? `scale=-2:${target}:flags=lanczos` : `scale=${target}:-2:flags=lanczos`;
}

/** Taille d'un fichier (journal). */
export async function sizeOf(file: string): Promise<number> {
  return (await stat(file)).size;
}
