#!/usr/bin/env node
/**
 * Lot 116 (son des vidéos) : détection et encodage sur des vidéos SYNTHÉTIQUES de 2 s générées ici par ffmpeg (sinus 440 Hz + mire) :
 * mp4 h264/aac, mov, webm vp8/opus, mkv, mkv/mp3, audio avant la vidéo, deux pistes audio (la première muette), mono, sans audio, piste muette.
 * Pour chaque variante : `hasAudio` du produit (piste AUDIBLE), piste présente dans CHAQUE sortie (ffprobe), niveau mesuré (volumedetect) pour le son,
 * absence de piste pour les vidéos sans son ou muettes. Règles pures : badge / modes. Usage : node --import tsx scripts/test-video116.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "t116-"));
process.env.DATA_DIR = path.join(dir, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });

const { runProbe } = await import("../src/lib/video/probe.ts");
const { pickAudioTrack, peakOfTrack, SILENCE_DB } = await import("../src/lib/video/audio.ts");
const { transcodeVideo } = await import("../src/lib/video/transcode.ts");
const { isLoop } = await import("../src/lib/video/limits.ts");
const { videoView } = await import("../src/lib/media.ts");

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const ff = (...args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const V = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "2"];
const A = (hz = 440) => ["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100`];
const SILENT = ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];

/** name, ext, container (comme sniffVideo), args, son attendu (audible), piste attendue dans la source */
const CASES = [
  ["mp4 h264/aac", "mp4", "mov", [...V, ...A(), ...X264, "-c:a", "aac", "-shortest"], true],
  ["mov h264/aac", "mov", "mov", [...V, ...A(), ...X264, "-c:a", "aac", "-shortest"], true],
  ["webm vp8/opus", "webm", "matroska", [...V, ...A(), "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k", "-c:a", "libopus", "-shortest"], true],
  ["mkv h264/aac", "mkv", "matroska", [...V, ...A(), ...X264, "-c:a", "aac", "-shortest"], true],
  ["mkv h264/mp3", "mkv", "matroska", [...V, ...A(), ...X264, "-c:a", "libmp3lame", "-shortest"], true],
  ["audio avant la vidéo (flux 0 = audio)", "mkv", "matroska", ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "2", ...X264, "-c:a", "aac", "-map", "0:a", "-map", "1:v", "-shortest"], true],
  ["deux pistes audio, la première muette", "mkv", "matroska", [...V, ...SILENT, ...A(), ...X264, "-c:a", "aac", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-shortest"], true],
  ["mono", "mp4", "mov", [...V, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", ...X264, "-c:a", "aac", "-ac", "1", "-shortest"], true],
  ["sans audio", "mp4", "mov", [...V, ...X264, "-an"], false],
  ["piste audio silencieuse", "mp4", "mov", [...V, ...SILENT, ...X264, "-c:a", "aac", "-shortest"], false],
];

/** Crête (dB) de la première piste audio d'un fichier mp4 produit, par ffmpeg. */
function level(file) {
  try {
    const out = execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    void out;
    return null;
  } catch (e) {
    const m = /max_volume:\s*(-?inf|-?[\d.]+) dB/.exec(String(e.stderr ?? ""));
    return m ? (m[1].endsWith("inf") ? -Infinity : Number(m[1])) : null;
  }
}
const audioStreams = (file) =>
  execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name,channels", "-of", "csv=p=0", file]).toString().trim().split("\n").filter(Boolean);
// volumedetect écrit sur stderr même en succès : on le lit par un spawn qui garde stderr
import { spawnSync } from "node:child_process";
const peak = (file) => {
  const r = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const m = /max_volume:\s*(-?inf|-?[\d.]+) dB/.exec(r.stderr ?? "");
  return m ? (m[1].endsWith("inf") ? -Infinity : Number(m[1])) : null;
};
void level;

let n = 0;
for (const [name, ext, container, args, audible] of CASES) {
  const file = path.join(dir, `v${n}.${ext}`);
  ff(...args, file);
  const probe = await runProbe(file, container);
  const present = probe.audioStreams.length > 0;
  ok(`${name} : ffprobe voit la piste son de la source (${probe.audioStreams.length} piste(s))`, present === (name !== "sans audio"), JSON.stringify(probe.audioStreams));
  const track = await pickAudioTrack(file, container, probe.audioStreams);
  ok(`${name} : piste choisie ${audible ? "(audible)" : "(aucune)"}`, audible ? track === (name.startsWith("deux pistes") ? 1 : 0) : track === null, String(track));
  const { result } = await transcodeVideo({ file, container, hash16: `h116${String(n).padStart(2, "0")}`, jobId: 1000 + n }, () => {});
  ok(`${name} : hasAudio du produit = ${audible}`, result.hasAudio === audible, String(result.hasAudio));
  const mp4s = result.files.filter((f) => f.format === "mp4");
  ok(`${name} : au moins une sortie mp4`, mp4s.length >= 1);
  for (const f of mp4s) {
    const out = path.join(process.env.DATA_DIR, "media", f.key);
    ok(`${name} : ${f.key} existe`, existsSync(out));
    const streams = audioStreams(out);
    if (audible) {
      ok(`${name} : ${f.key} contient la piste son (aac stéréo)`, streams.length === 1 && streams[0].startsWith("aac,2"), JSON.stringify(streams));
      const p = peak(out);
      ok(`${name} : ${f.key} niveau crête audible (> -30 dB)`, p !== null && p > -30, String(p));
    } else {
      ok(`${name} : ${f.key} sans piste son`, streams.length === 0, JSON.stringify(streams));
    }
  }
  const view = videoView({ kind: "video", variants: JSON.stringify(result.files), dominantColor: null, duration: result.duration, hasAudio: result.hasAudio });
  if (view) {
    ok(`${name} : la vue vidéo porte hasAudio=${audible} et loop=${!audible}`, view.hasAudio === audible && view.loop === isLoop({ duration: result.duration, hasAudio: result.hasAudio }));
  }
  n++;
}

// Mesure de crête : un sinus est audible, un silence ne l'est pas ; le seuil est fixé.
const loud = path.join(dir, "v0.mp4");
const pk = await peakOfTrack(loud, "mov", "aac", 0);
ok("peakOfTrack : un sinus 440 Hz est audible (crête > seuil)", pk !== null && pk > SILENCE_DB, String(pk));
ok("pickAudioTrack : aucune piste = null", (await pickAudioTrack(loud, "mov", [])) === null);

rmSync(dir, { recursive: true, force: true });
if (failures) {
  console.error(`test-video116 : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-video116 : OK");
