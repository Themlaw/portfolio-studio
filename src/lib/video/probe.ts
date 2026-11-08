/**
 * ffprobe, lancé de façon défensive : arguments en tableau (jamais de
 * shell), protocole « file » seul, format d'entrée forcé (liste blanche),
 * délai dur. Renvoie ce qu'il faut pour valider et décrire une vidéo.
 */
import { spawn } from "node:child_process";

import { ffmpegEnv } from "./limits";

export type Probe = {
  formatName: string;
  duration: number;
  /** Dimensions d'affichage (rotation appliquée). */
  width: number;
  height: number;
  rotation: number;
  hasAudio: boolean;
  videoCodec: string;
  /** Codec de la première piste audio, ou null. */
  audioCodec: string | null;
  /** Codec de chaque piste audio, dans l ordre du fichier (lot 116). */
  audioStreams: string[];
  tags: { format: Record<string, string>; streams: Record<string, string>[] };
  sideData: string[];
};

type Stream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
};

const MAX_OUTPUT = 1024 * 1024;

export function runProbe(file: string, container: "mov" | "matroska" | "mp4", timeoutMs = 30_000): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-protocol_whitelist", "file", "-f", container, "-show_format", "-show_streams", "-of", "json", "file:" + file];
    // Priorité basse dès le lancement (nice), arguments en tableau.
    // Environnement minimal (aucun secret) : ffmpegEnv de limits.ts.
    const child = spawn("nice", ["-n", "10", "ffprobe", ...args], { stdio: ["ignore", "pipe", "pipe"], env: ffmpegEnv() });
    let out = "";
    let err = "";
    let tooLong = false;
    child.stdout.on("data", (d) => {
      out += d;
      // Sortie bornée (1 Mo) : au-delà, le fichier est rejeté.
      if (out.length > MAX_OUTPUT) {
        tooLong = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (tooLong) return reject(new Error("ffprobe : description trop longue"));
      if (code !== 0) return reject(new Error(`ffprobe : ${err.trim().split("\n").pop() ?? code}`));
      try {
        const json = JSON.parse(out) as { format?: { format_name?: string; duration?: string; tags?: Record<string, string> }; streams?: Stream[] };
        const streams = json.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video" && (s.width ?? 0) > 0);
        if (!video) return reject(new Error("aucune piste vidéo"));
        const rot = video.side_data_list?.find((d) => d.side_data_type === "Display Matrix")?.rotation ?? Number(video.tags?.rotate ?? 0);
        const quarter = Math.abs(Math.round(rot / 90)) % 2 === 1;
        resolve({
          formatName: json.format?.format_name ?? "",
          duration: Number(json.format?.duration ?? 0),
          width: quarter ? video.height! : video.width!,
          height: quarter ? video.width! : video.height!,
          rotation: rot,
          hasAudio: streams.some((s) => s.codec_type === "audio"),
          videoCodec: video.codec_name ?? "",
          audioCodec: streams.find((s) => s.codec_type === "audio")?.codec_name ?? null,
          audioStreams: streams.filter((s) => s.codec_type === "audio").map((s) => s.codec_name ?? ""),
          tags: { format: json.format?.tags ?? {}, streams: streams.map((s) => s.tags ?? {}) },
          sideData: streams.flatMap((s) => (s.side_data_list ?? []).map((d) => d.side_data_type ?? "")),
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}
