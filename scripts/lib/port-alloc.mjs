#!/usr/bin/env node
/**
 * Allocateur de blocs de ports (lot 104) : chaque job de la batterie reçoit un bloc de
 * ports libres et contigus (serveur, serveurs annexes de backup85 / auth / domaine88…).
 * Plus de collision quelle que soit la valeur de BATT_JOBS, et plusieurs batteries (ou
 * plusieurs batteries) peuvent partager la plage tant qu'elles utilisent le même dossier de verrous.
 *
 * Principe : un fichier de verrou par bloc, créé de façon atomique (`wx`), contenant le pid
 * du propriétaire. Un verrou dont le pid est mort est repris. Le bloc est aussi sondé (bind
 * sur 127.0.0.1 et ::) : un port occupé par un tiers fait sauter le bloc, jamais tuer le tiers.
 *
 * Module : alloc({ min, max, size, dir, owner }) → { port, release() } ; release(port, dir).
 * CLI :
 *   node scripts/lib/port-alloc.mjs alloc [--min 3800] [--max 3899] [--size 8] [--dir D] [--owner PID] [--wait SEC]
 *       → affiche le premier port du bloc (code 1 si plage épuisée après --wait)
 *   node scripts/lib/port-alloc.mjs release <port> [--dir D]
 *   node scripts/lib/port-alloc.mjs list [--dir D]
 * Environnement : BATT_PORT_MIN, BATT_PORT_MAX, BATT_PORT_BLOCK, BATT_PORT_DIR.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DIR = process.env.BATT_PORT_DIR || path.join(os.tmpdir(), "batt-ports");

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** Le port est-il libre ? (bind sur IPv4 et IPv6 ; une famille absente de la machine ne compte pas comme occupée) */
export function portFree(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", (e) => resolve(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT"));
      s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
    });
  return probe("127.0.0.1").then((a) => (a ? probe("::") : false));
}

/**
 * Contenu d'un verrou : « hôte pid ». Un verrou posé depuis un autre hôte (autre conteneur : les pid ne sont pas
 * comparables) est considéré vivant tant qu'il a moins de STALE_H heures ; le sondage du port reste l'arbitre final.
 */
const STALE_H = Number(process.env.BATT_PORT_STALE_H ?? 12);
function lockAlive(file) {
  try {
    const [host, pid] = readFileSync(file, "utf8").trim().split(/\s+/);
    if (host === os.hostname()) return pidAlive(Number(pid));
    return Date.now() - statSync(file).mtimeMs < STALE_H * 3600e3;
  } catch {
    return false;
  }
}

function lockFile(dir, port) {
  return path.join(dir, `${port}.lock`);
}

/** Pose le verrou d'un bloc (atomique). Reprend un verrou mort. Renvoie true si posé. */
function takeLock(dir, port, owner) {
  const f = lockFile(dir, port);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(f, "wx");
      writeSync(fd, `${os.hostname()} ${owner}`);
      closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (lockAlive(f)) return false;
      // Verrou mort : on tente de le reprendre en le supprimant (le wx suivant arbitre entre concurrents).
      try {
        rmSync(f);
      } catch {
        // déjà repris par un autre
      }
    }
  }
  return false;
}

function dropLock(dir, port) {
  try {
    rmSync(lockFile(dir, port));
  } catch {
    // déjà libéré
  }
}

/**
 * Cherche un bloc libre de `size` ports dans [min, max]. Les blocs sont alignés sur `size`
 * à partir de `min`. `owner` : pid dont la mort libère le bloc (défaut : le processus appelant).
 */
export async function alloc({ min, max, size = 8, dir = DEFAULT_DIR, owner = process.pid, waitSec = 0, pollMs = 500 }) {
  mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + waitSec * 1000;
  for (;;) {
    for (let base = min; base + size - 1 <= max; base += size) {
      // Un verrou par PORT du bloc : deux batteries qui n'ont pas le même `size` ne se chevauchent pas.
      const taken = [];
      let ok = true;
      for (let p = base; p < base + size; p++) {
        if (takeLock(dir, p, owner)) taken.push(p);
        else {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let p = base; p < base + size && ok; p++) if (!(await portFree(p))) ok = false;
      }
      if (ok) return { port: base, size, release: () => release(base, size, dir) };
      for (const p of taken) dropLock(dir, p);
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export function release(port, size = 8, dir = DEFAULT_DIR) {
  for (let p = port; p < port + size; p++) dropLock(dir, p);
}

/** Verrous actuels : [{ port, pid, alive }] */
export function list(dir = DEFAULT_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".lock"))
    .map((f) => {
      const file = path.join(dir, f);
      return { port: Number(f.slice(0, -5)), pid: Number(readFileSync(file, "utf8").trim().split(/\s+/)[1]), alive: lockAlive(file) };
    })
    .sort((a, b) => a.port - b.port);
}

function arg(argv, name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2);
  const dir = arg(rest, "dir", DEFAULT_DIR);
  const size = Number(arg(rest, "size", process.env.BATT_PORT_BLOCK ?? 8));
  if (cmd === "alloc") {
    const min = Number(arg(rest, "min", process.env.BATT_PORT_MIN ?? 3800));
    const max = Number(arg(rest, "max", process.env.BATT_PORT_MAX ?? 3899));
    const owner = Number(arg(rest, "owner", process.ppid));
    const b = await alloc({ min, max, size, dir, owner, waitSec: Number(arg(rest, "wait", 0)) });
    if (!b) {
      console.error(`plus de bloc de ${size} ports libre dans ${min}-${max}`);
      process.exit(1);
    }
    console.log(b.port);
  } else if (cmd === "release") {
    release(Number(rest[0]), size, dir);
  } else if (cmd === "list") {
    for (const l of list(dir)) console.log(`${l.port}\t${l.pid}\t${l.alive ? "vivant" : "mort"}`);
  } else {
    console.error("usage : port-alloc.mjs alloc|release|list");
    process.exit(2);
  }
}
