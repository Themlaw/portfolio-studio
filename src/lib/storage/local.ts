import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ByteRange, MediaStorage, StoredObject } from "./types";

/** Clé valide : segments [A-Za-z0-9._-], séparés par "/", sans "." ni ".." seuls. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidKey(key: string): boolean {
  if (!key || key.length > 512) return false;
  return key.split("/").every((s) => SEGMENT.test(s) && s !== "." && s !== "..");
}

/**
 * Stockage sur disque. Garde-fous : clé filtrée, chemin résolu sous la
 * racine, et en lecture le fichier doit être un fichier régulier (lstat : un
 * lien symbolique est refusé) dont le chemin réel (realpath, qui résout aussi
 * les dossiers intermédiaires) reste sous la racine réelle.
 */
export class LocalStorage implements MediaStorage {
  private realRoot: string | null = null;

  constructor(private readonly root: string) {}

  /** Chemin absolu d'une clé, garanti lexicalement sous la racine. */
  private resolve(key: string): string {
    if (!isValidKey(key)) throw new Error(`Clé de média invalide : ${JSON.stringify(key)}`);
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Clé hors du stockage");
    return full;
  }

  /** Chemin d'un fichier existant et sûr à lire, ou null. */
  private async safeExisting(key: string): Promise<{ file: string; size: number; mtimeMs: number } | null> {
    let file: string;
    try {
      file = this.resolve(key);
    } catch {
      return null;
    }
    try {
      const info = await lstat(file);
      if (!info.isFile()) return null; // lien symbolique, dossier, périphérique…
      this.realRoot ??= await realpath(path.resolve(this.root));
      const real = await realpath(file);
      if (!real.startsWith(this.realRoot + path.sep)) return null;
      return { file: real, size: info.size, mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  }

  async put(key: string, stream: Readable | NodeJS.ReadableStream): Promise<StoredObject> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Écriture atomique : fichier temporaire (création exclusive) puis renommage.
    // Nom unique : deux écritures simultanées de la même clé ne se télescopent pas.
    const tmp = `${target}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await pipeline(stream as Readable, createWriteStream(tmp, { flags: "wx" }));
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    const stored = await this.stat(key);
    if (!stored) throw new Error(`Écriture du média ${key} invérifiable`);
    return stored;
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    const safe = await this.safeExisting(key);
    if (!safe) throw new Error(`Média introuvable : ${key}`);
    return createReadStream(safe.file, range ? { start: range.start, end: range.end } : undefined);
  }

  async stat(key: string): Promise<StoredObject | null> {
    const safe = await this.safeExisting(key);
    return safe ? { size: safe.size, mtimeMs: safe.mtimeMs } : null;
  }

  async localPath(key: string): Promise<string | null> {
    return (await this.safeExisting(key))?.file ?? null;
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    // Dossier de variantes devenu vide (img/<hash>/) : retiré aussi.
    const dir = path.dirname(file);
    if (dir !== path.resolve(this.root) && path.dirname(dir) !== path.dirname(path.resolve(this.root))) {
      await rmdir(dir).catch(() => {});
    }
  }
}
