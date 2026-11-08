#!/usr/bin/env node
/**
 * Sécurité v1.0 : #32, ffmpeg et ffprobe lancés avec un environnement minimal ; jeton interne hors de process.env.
 * Des « ffmpeg » / « ffprobe » espions (script qui note son environnement puis lance le vrai) sont placés en tête du PATH ; le serveur
 * simulé porte des secrets synthétiques. PASS = aucun secret n'atteint un processus enfant, la vidéo est quand même convertie.
 * Usage (conteneur avec ffmpeg) : node --import tsx scripts/secuB-ffmpeg.mjs
 * Chaque lancement de la couche vidéo est testé séparément : sonde (probe.ts), conversion (transcode.ts), mesure du son (audio.ts).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { finish, ok, info, ROOT } from "./lib/secu-b.mjs";

const SELF = new URL(import.meta.url).pathname;
const SECRETS = { BETTER_AUTH_SECRET: "SYNTH-secret-auth-0123456789", OIDC_CLIENT_SECRET: "SYNTH-oidc-secret-abc", ADMIN_PASSWORD: "SYNTH-mot-de-passe-admin", AUTH_SECRET_FILE: "/run/secrets/synth" };
const SECRET_NAME = /SECRET|PASSWORD|TOKEN|PASSWD|CREDENTIAL|API_KEY/i;

if (process.argv[2] === "child") {
  Object.assign(process.env, SECRETS, { DATA_DIR: process.env.SECUB_DATA });
  const { internalToken } = await import("../src/lib/jobs/notify.ts");
  const token = internalToken(); // le serveur le crée au premier appel (route / worker)
  const file = process.env.SECUB_VIDEO;
  const which = process.argv[3];
  const out = { tokenInProcessEnv: process.env.PORTFOLIO_INTERNAL_TOKEN === token, token };
  if (which === "probe") {
    const { runProbe } = await import("../src/lib/video/probe.ts");
    const p = await runProbe(file, "mov");
    out.probe = { video: p.videoCodec, audio: p.audioStreams };
  } else if (which === "audio") {
    const { peakOfTrack } = await import("../src/lib/video/audio.ts");
    out.peak = await peakOfTrack(file, "mov", "aac", 0);
  } else if (which === "transcode") {
    const { transcodeVideo } = await import("../src/lib/video/transcode.ts");
    const r = await transcodeVideo({ file, container: "mov", hash16: "0123456789abcdef", jobId: 1 }, () => {});
    out.transcode = { files: r.result.files.length, w: r.result.width, h: r.result.height, hasAudio: r.result.hasAudio };
  }
  console.log(`RESULT ${JSON.stringify(out)}`);
  process.exit(0);
}

const tmp = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-ff-"));
const shims = path.join(tmp, "shims");
const dumps = path.join(tmp, "dumps");
mkdirSync(shims);
mkdirSync(dumps);
mkdirSync(path.join(tmp, "data"));
const real = (n) => spawnSync("sh", ["-c", `command -v ${n}`], { encoding: "utf8" }).stdout.trim();
for (const n of ["ffmpeg", "ffprobe"]) {
  writeFileSync(path.join(shims, n), `#!/bin/sh\nenv > "${dumps}/${n}.$$.env"\nexec ${real(n)} "$@"\n`);
  chmodSync(path.join(shims, n), 0o755);
}
// vidéo synthétique avec son audible (3 s)
const video = path.join(tmp, "synth.mov");
const mk = spawnSync(real("ffmpeg"), ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mov", video], { encoding: "utf8" });
if (mk.status !== 0) throw new Error(mk.stderr);

const names = () => readdirSync(dumps);
function run(which) {
  for (const f of names()) spawnSync("rm", ["-f", path.join(dumps, f)]);
  const r = spawnSync(process.execPath, ["--import", "tsx", SELF, "child", which], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 240_000,
    env: { PATH: `${shims}:${process.env.PATH}`, HOME: process.env.HOME, SECUB_DATA: path.join(tmp, "data"), SECUB_VIDEO: video, NODE_ENV: "production", PORTFOLIO_SELF_PORT: "3999" },
  });
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  const result = line ? JSON.parse(line.slice(7)) : null;
  const seen = names().map((f) => ({ f, env: readFileSync(path.join(dumps, f), "utf8") }));
  return { result, seen, stderr: r.stderr.slice(-300) };
}
function leak(seen, token) {
  const found = new Set();
  for (const { env } of seen) {
    for (const line of env.split("\n")) {
      const [k, ...v] = line.split("=");
      const val = v.join("=");
      if (SECRET_NAME.test(k)) found.add(k);
      if (Object.values(SECRETS).includes(val) || (token && val.includes(token))) found.add(k);
    }
  }
  return [...found];
}

for (const [which, label, expectSpawns] of [["probe", "sonde (probe.ts, ffprobe)", 1], ["transcode", "conversion (transcode.ts : sonde + ffmpeg)", 2], ["audio", "mesure du son (audio.ts, ffmpeg volumedetect, lot 116/127)", 1]]) {
  const r = run(which);
  const l = leak(r.seen, r.result?.token);
  info(`${label}`, `${r.seen.length} lancement(s) espionné(s), variables transmises : ${r.seen[0] ? r.seen[0].env.split("\n").filter(Boolean).map((x) => x.split("=")[0]).join(",") : "-"}`);
  ok(`SB32 ${label} : aucun secret dans l'environnement de l'enfant`, r.seen.length >= expectSpawns && l.length === 0, l.length ? `FUITE : ${l.join(", ")}` : `lancements : ${r.seen.length} ; ${r.stderr}`);
  if (which === "probe") ok("SB32 le jeton interne n'est plus dans process.env du serveur", r.result && r.result.tokenInProcessEnv === false, `dans process.env : ${r.result?.tokenInProcessEnv}`);
  if (which === "transcode") ok("SB32 la vidéo est bien convertie avec l'environnement minimal (2 variantes, 640 × 360, avec son)", r.result?.transcode?.files >= 1 && r.result.transcode.h === 360 && r.result.transcode.hasAudio === true, JSON.stringify(r.result?.transcode ?? r.stderr));
  if (which === "audio") ok("SB32 la mesure du son fonctionne avec l'environnement minimal (crête audible)", typeof r.result?.peak === "number" && r.result.peak > -70, String(r.result?.peak));
}
finish();
