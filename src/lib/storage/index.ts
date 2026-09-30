import path from "node:path";

import { dataDir } from "@/lib/db";

import { LocalStorage } from "./local";
import type { MediaStorage } from "./types";

export type { ByteRange, MediaStorage, StoredObject } from "./types";
export { isValidKey } from "./local";

let instance: MediaStorage | null = null;

/** Stockage actif (local sur ${DATA_DIR}/media ; S3 plus tard). */
export function getStorage(): MediaStorage {
  instance ??= new LocalStorage(path.join(dataDir(), "media"));
  return instance;
}

/** Clé versionnée par le contenu : <hash16>-<nom-nettoyé>.<ext>. */
export function contentKey(hash: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const base = path
    .basename(filename, path.extname(filename))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${hash.slice(0, 16)}-${base || "media"}${ext}`;
}
