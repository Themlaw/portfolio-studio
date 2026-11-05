#!/usr/bin/env node
/**
 * Lancement défensif de ffmpeg / ffprobe (analyse statique des sources) et
 * règles pures des vidéos (liste blanche de codecs, boucle).
 * Usage : npm test
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const transcode = read("src/lib/video/transcode.ts");
const probe = read("src/lib/video/probe.ts");
const audio = read("src/lib/video/audio.ts");
const limits = await import(new URL("../src/lib/video/limits.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

// Chaque lancement passe par nice 10, arguments en tableau, jamais de shell.
for (const [name, src] of [["transcode.ts", transcode], ["probe.ts", probe], ["audio.ts", audio]]) {
  const spawns = [...src.matchAll(/spawn\(([^,]+),\s*\[([^\]]*)/g)];
  ok(`${name} : au moins un lancement`, spawns.length > 0);
  for (const m of spawns) {
    ok(`${name} : spawn("nice", ["-n", "10", …])`, m[1].trim() === '"nice"' && /^"-n", "10", "(ffmpeg|ffprobe)"/.test(m[2].trim()), m[0].slice(0, 80));
  }
  ok(`${name} : spawn seul (pas de shell)`, /import \{ spawn \} from "node:child_process"/.test(src) && !/shell:\s*true/.test(src));
}
// Toute entrée (-i) : protocole file seul, format forcé et décodeur forcé AVANT -i.
// Fenêtre : du début du tableau d'arguments (ligne « [ » la plus proche) jusqu'à -i.
const arrays = [...transcode.matchAll(/"-i"/g)].map((m) => {
  const start = Math.max(transcode.lastIndexOf("args = [", m.index), transcode.lastIndexOf("runFfmpeg(\n", m.index), transcode.lastIndexOf("[\"-threads\"", m.index));
  return transcode.slice(start, m.index + 4);
});
ok("transcode.ts : entrées trouvées", arrays.length >= 2, String(arrays.length));
for (const a of arrays) {
  const before = a.slice(0, a.indexOf('"-i"'));
  ok(
    "entrée : -protocol_whitelist file, -f et -c:v avant -i",
    /"-protocol_whitelist", "file"/.test(before) && /"-f"/.test(before) && (/"-c:v"/.test(before) || /decoderArgs\(/.test(before)),
    a.replace(/\s+/g, " ").slice(0, 160),
  );
}
ok("probe.ts : -protocol_whitelist file et -f", /"-protocol_whitelist", "file", "-f", container/.test(probe));
ok("transcode.ts : -max_alloc", /"-max_alloc"/.test(transcode));

ok("codecs vidéo acceptés", ["h264", "hevc", "vp8", "vp9", "av1", "prores", "mpeg4"].every(limits.isAllowedVideo));
ok("codecs vidéo refusés (mjpeg, ffv1, rawvideo, gif)", !["mjpeg", "ffv1", "rawvideo", "gif", ""].some(limits.isAllowedVideo));
ok("codecs audio acceptés (dont pcm_*)", ["aac", "mp3", "opus", "vorbis", "flac", "alac", "pcm_s16le", "pcm_f32le"].every(limits.isAllowedAudio));
ok("codecs audio refusés (ac3, dts, wmav2)", !["ac3", "dts", "wmav2", "pcm_", "pcm_x;y"].some(limits.isAllowedAudio));
ok("AV1 décodé par dav1d", limits.decoderFor("av1") === "libdav1d" && limits.decoderFor("h264") === "h264");
ok("boucle : muette et < 20 s", limits.isLoop({ duration: 4, hasAudio: false }) && !limits.isLoop({ duration: 4, hasAudio: true }) && !limits.isLoop({ duration: 25, hasAudio: false }) && !limits.isLoop({ duration: null, hasAudio: false }));

if (failures) {
  console.error(`test-ffmpeg-args : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-ffmpeg-args : OK");
