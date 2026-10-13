/**
 * Import d'un ou plusieurs PSD dans les conditions du processus enfant de
 * production (tas JS borné, MALLOC_ARENA_MAX) : durée et pic mémoire (VmHWM).
 * Usage : MALLOC_ARENA_MAX=2 MALLOC_MMAP_THRESHOLD_=131072 node --expose-gc --max-old-space-size=256 --import tsx scripts/kit-poc/measure-import.mts <sortie> <fichier.psd>…
 */
import { readFileSync } from "node:fs";

import { importKit } from "@/lib/kit/import";

const [out, ...files] = process.argv.slice(2);
const t = Date.now();
const r = await importKit(files, out, {});
const hwm = Number(/VmHWM:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))?.[1]) / 1024;
console.log(JSON.stringify({ ms: Date.now() - t, vmHWM_Mo: Math.round(hwm), afterReadMb: r.afterReadMb, afterFreeMb: r.afterFreeMb, ok: r.ok, problem: r.problem, plans: r.slots.filter((s) => s.id.startsWith("decor/")).map((s) => `${s.chosen ?? s.change}:${Math.round((s.bytes ?? 0) / 1024)}Ko:${s.peakMb}Mo`) }));
