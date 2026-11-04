/** Limites des vidéos (variables d'environnement, valeurs par défaut sûres). */
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name] || fallback);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const videoLimits = () => ({
  maxBytes: num("MAX_VIDEO_MB", 2048) * 1024 * 1024,
  maxDurationS: num("MAX_VIDEO_DURATION_S", 1800),
  maxDimension: num("MAX_VIDEO_DIMENSION", 3840),
  jobMaxMs: num("VIDEO_JOB_MAX_DURATION_S", 3600) * 1000,
  keepOriginals: process.env.KEEP_VIDEO_ORIGINALS === "true",
});

/**
 * Environnement de ffmpeg et ffprobe : MINIMAL, comme poppler et l'enfant du kit. Jamais `process.env` hérité : il porte les secrets
 * (BETTER_AUTH_SECRET, secret OIDC, ADMIN_PASSWORD s'il est resté) et ces outils analysent des fichiers envoyés. Liste blanche : rien
 * d'autre n'est transmis, quelle que soit la configuration du serveur.
 */
export const FFMPEG_ENV_KEYS = ["PATH", "NODE_ENV", "LANG", "HOME", "XDG_CACHE_HOME", "TMPDIR"] as const;
export function ffmpegEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: process.env.NODE_ENV ?? "production", LANG: "C.UTF-8", HOME: "/tmp", XDG_CACHE_HOME: "/tmp", TMPDIR: "/tmp" };
}

/**
 * Codecs acceptés à l'entrée (le décodeur est forcé à la conversion : aucun
 * autre décodeur de ffmpeg n'est atteignable depuis un fichier envoyé).
 */
export const VIDEO_CODECS = ["h264", "hevc", "vp8", "vp9", "av1", "prores", "mpeg4"] as const;
export const AUDIO_CODECS = ["aac", "mp3", "opus", "vorbis", "flac", "alac"] as const;
export const isAllowedAudio = (c: string) => (AUDIO_CODECS as readonly string[]).includes(c) || /^pcm_[a-z0-9]+$/.test(c);
export const isAllowedVideo = (c: string) => (VIDEO_CODECS as readonly string[]).includes(c);
/** Nom du décodeur ffmpeg d'un codec accepté (AV1 : dav1d). */
export const decoderFor = (codec: string) => (codec === "av1" ? "libdav1d" : codec);

/** Taille d'un morceau d'envoi. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

/** Une vidéo muette de moins de 20 s est une « boucle » (planches). */
export const LOOP_MAX_S = 20;
export const isLoop = (m: { duration: number | null; hasAudio: boolean | null }) =>
  m.hasAudio === false && m.duration !== null && m.duration < LOOP_MAX_S;

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
