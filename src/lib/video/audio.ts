/**
 * Choix de la piste son d'une vidéo (lot 116). Une vidéo peut avoir plusieurs pistes audio (la première muette, le son réel en
 * seconde position) ou une piste entièrement silencieuse (export d'enregistrement d'écran) : on mesure le niveau crête de chaque piste
 * (filtre `volumedetect`, audio seul) et on garde la première audible. Aucune piste audible = vidéo sans son (`-an`, pas de bouton son).
 * ffmpeg est lancé comme ailleurs : arguments en tableau, nice, protocole file seul, format et décodeur forcés, délai dur. Un échec ou
 * un dépassement de délai garde la première piste (le son n'est jamais retiré à cause d'une mesure ratée).
 */
import { spawn } from "node:child_process";

import { decoderFor } from "./limits";

/** Crête (dBFS) en dessous de laquelle une piste est tenue pour silencieuse. */
export const SILENCE_DB = -70;
/** Pistes mesurées au plus (le reste est ignoré). */
const MAX_TRACKS = 4;

/** Crête de la piste audio n° `index` (dBFS), `-Infinity` pour un silence numérique, null si la mesure a échoué. */
export function peakOfTrack(file: string, container: "mov" | "matroska" | "mp4", codec: string, index: number, timeoutMs = 120_000): Promise<number | null> {
  return new Promise((resolve) => {
    const args = [
      "-nostdin", "-hide_banner", "-threads", "1", "-c:a", decoderFor(codec), "-protocol_whitelist", "file", "-f", container === "mp4" ? "mov" : container,
      "-i", "file:" + file, "-map", `0:a:${index}`, "-vn", "-sn", "-dn", "-af", "volumedetect", "-f", "null", "-",
    ];
    const child = spawn("nice", ["-n", "10", "ffmpeg", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err = (err + d).slice(-8000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const m = /max_volume:\s*(-?inf|-?[\d.]+) dB/.exec(err);
      if (!m) return resolve(null);
      resolve(m[1].endsWith("inf") ? -Infinity : Number(m[1]));
    });
  });
}

/** Indice (parmi les pistes audio) de la piste à garder, ou null si aucune n'est audible. */
export async function pickAudioTrack(file: string, container: "mov" | "matroska" | "mp4", codecs: string[]): Promise<number | null> {
  if (!codecs.length) return null;
  for (let i = 0; i < Math.min(codecs.length, MAX_TRACKS); i++) {
    const peak = await peakOfTrack(file, container, codecs[i], i);
    if (peak === null) return i; // mesure impossible : on garde le son
    if (peak > SILENCE_DB) return i;
  }
  return null;
}
