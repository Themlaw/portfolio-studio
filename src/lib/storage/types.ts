import type { Readable } from "node:stream";

export type ByteRange = { start: number; end: number }; // bornes incluses

export type StoredObject = { size: number; mtimeMs: number };

/**
 * Stockage des médias. Implémentation locale aujourd'hui (${DATA_DIR}/media),
 * S3/Garage plus tard, même contrat : les composants n'en savent rien.
 */
export interface MediaStorage {
  /** Écrit l'objet en flux (jamais tout en mémoire). Écrase si la clé existe. */
  put(key: string, stream: Readable | NodeJS.ReadableStream): Promise<StoredObject>;
  /** Flux de lecture, éventuellement restreint à une plage d'octets. */
  getStream(key: string, range?: ByteRange): Promise<Readable>;
  /** Métadonnées, ou null si la clé n'existe pas. */
  stat(key: string): Promise<StoredObject | null>;
  /**
   * Chemin local d'un objet existant (lecture par fichier : sharp ne garde
   * alors pas tout le contenu en mémoire), ou null si le stockage est distant.
   */
  localPath(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}
