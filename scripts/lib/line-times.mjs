/**
 * Lot 104b : horodatage des lignes PASS/FAIL (mesure des durées par section pour le découpage des suites).
 * Chargé par `node --import scripts/lib/line-times.mjs script.mjs` (test-all-local.sh le fait avec BATT_TIMES=1).
 * Écrit « secondes depuis le début <TAB> ligne » dans $BATT_TIMES_FILE ; sans cette variable, ne fait rien.
 * Les lignes de titre de section (« == … », « ===== ») sont horodatées aussi.
 */
import { appendFileSync } from "node:fs";

const FILE = process.env.BATT_TIMES_FILE;
if (FILE) {
  const t0 = Date.now();
  const real = console.log;
  console.log = function patched(...args) {
    try {
      const line = String(args[0] ?? "");
      if (/^(PASS|FAIL|=+ |==)/.test(line.trimStart()) || /^\n?==/.test(line)) appendFileSync(FILE, `${((Date.now() - t0) / 1000).toFixed(1)}\t${line.replace(/\n/g, "⏎").slice(0, 160)}\n`);
    } catch {
      // mesure best effort
    }
    return real.apply(this, args);
  };
}
