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
const limits = await import(new URL("../src/lib/video/limits.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

// Chaque lancement passe par nice 10, arguments en tableau, jamais de shell.
for (const [name, src] of [["transcode.ts", transcode], ["probe.ts", probe]]) {
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
// Environnement minimal (docs/SECURITE.md N10, P7) : chaque lancement passe `env: ffmpegEnv()`, jamais l'environnement du serveur.
for (const [name, src] of [["transcode.ts", transcode], ["probe.ts", probe]]) {
  const calls = [...src.matchAll(/spawn\("nice",[\s\S]*?\}\);/g)].map((m) => m[0]);
  ok(`${name} : chaque spawn passe env: ffmpegEnv()`, calls.length > 0 && calls.every((c) => /env:\s*ffmpegEnv\(\)/.test(c)), calls.map((c) => c.slice(-120)).join(" | "));
  ok(`${name} : aucune lecture de process.env transmise à l'outil`, !/env:\s*(\{\s*\.\.\.process\.env|process\.env)/.test(src));
}
{
  const saved = { ...process.env };
  Object.assign(process.env, { BETTER_AUTH_SECRET: "secret-de-test", ADMIN_PASSWORD: "mdp", OIDC_CLIENT_SECRET: "oidc", PORTFOLIO_INTERNAL_TOKEN: "jeton" });
  const env = limits.ffmpegEnv();
  const keys = Object.keys(env).sort();
  ok("ffmpegEnv : liste blanche exacte (PATH, NODE_ENV, LANG, HOME, XDG_CACHE_HOME, TMPDIR)", JSON.stringify(keys) === JSON.stringify([...limits.FFMPEG_ENV_KEYS].sort()), keys.join(","));
  ok("ffmpegEnv : aucun secret, même présent dans l'environnement du serveur", !Object.values(env).some((v) => /secret|mdp|oidc|jeton/.test(v)));
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  // ffmpeg et ffprobe fonctionnent avec cet environnement (s'ils sont installés) : la sortie de `env` le montre aussi.
  const { spawnSync } = await import("node:child_process");
  const shown = spawnSync("nice", ["-n", "10", "env"], { env: limits.ffmpegEnv(), encoding: "utf8" });
  ok("environnement vu par l'outil = la liste blanche", shown.status === 0 && shown.stdout.trim().split("\n").map((l) => l.split("=")[0]).sort().join(",") === [...limits.FFMPEG_ENV_KEYS].sort().join(","), shown.stdout);
  const ff = spawnSync("nice", ["-n", "10", "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5", "-t", "1", "-f", "null", "-"], { env: limits.ffmpegEnv(), encoding: "utf8" });
  if (ff.error?.code === "ENOENT" || ff.status === 127) console.log("SKIP  ffmpeg absent : lancement réel non vérifié");
  else ok("ffmpeg tourne avec l'environnement minimal", ff.status === 0, ff.stderr);
}
// Jeton de revalidation interne : jamais rangé dans process.env (hérité par tout processus enfant).
const notify = read("src/lib/jobs/notify.ts");
ok("notify.ts : le jeton interne n'est pas dans process.env", !/process\.env\.PORTFOLIO_INTERNAL_TOKEN|process\.env\[[^\]]*TOKEN/.test(notify) && /globalThis/.test(notify));

ok("probe.ts : -protocol_whitelist file et -f",/"-protocol_whitelist", "file", "-f", container/.test(probe));
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
