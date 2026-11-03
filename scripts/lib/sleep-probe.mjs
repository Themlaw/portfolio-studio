/**
 * Lot 104 : sonde des attentes fixes. Chargée par `node --import scripts/lib/sleep-probe.mjs script.mjs`
 * (test-all-local.sh le fait avec BATT_SLEEP_PROBE=1). Cumule la durée demandée à `setTimeout` quand
 * l'appelant est un script de scripts/ (les `sleep = (ms) => new Promise((r) => setTimeout(r, ms))` des
 * suites), et l'écrit à la sortie, en secondes, dans $BATT_SLEEP_FILE (une valeur) ; le détail par
 * ligne d'appel va dans $BATT_SLEEP_FILE.detail (JSON). Sans BATT_SLEEP_FILE, ne fait rien.
 */
import { writeFileSync } from "node:fs";

const FILE = process.env.BATT_SLEEP_FILE;
if (FILE) {
  const real = globalThis.setTimeout;
  const byCaller = new Map();
  let total = 0;
  let polled = 0;
  globalThis.setTimeout = function patched(fn, ms, ...rest) {
    if (typeof ms === "number" && ms >= 20) {
      const stack = (new Error().stack ?? "").split("\n").slice(2, 12);
      // Attente en boucle d'une CONDITION (waitFor, until, settled…) : ce n'est pas une attente fixe, comptée à part.
      const polling = stack.some((l) => /\bat (async )?(waitFor|until|settled|poll\w*|waitReady|waitImage|retry\w*)\b/.test(l));
      const frames = stack.filter((l) => /\/scripts\/(e2e-|test-|lib\/)/.test(l) && !/sleep-probe/.test(l));
      if (frames.length) {
        const loc = (l) => l.replace(/^.*\/(scripts\/[^):]+:\d+).*$/, "$1");
        // La 1re trame est l'assistant `sleep` ; l'appelant (ligne de l'attente) est la suivante, d'une autre ligne.
        const first = loc(frames[0]);
        const caller = frames.map(loc).find((x) => x !== first) ?? first;
        if (polling) polled += ms;
        else {
          total += ms;
          byCaller.set(caller, (byCaller.get(caller) ?? 0) + ms);
        }
      }
    }
    return real.call(this, fn, ms, ...rest);
  };
  process.on("exit", () => {
    try {
      writeFileSync(FILE, String(Math.round(total / 1000)));
      writeFileSync(`${FILE}.detail`, JSON.stringify(Object.fromEntries([["_attente_de_condition_s", Math.round(polled / 1000)], ...byCaller].sort((a, b) => b[1] - a[1]).slice(0, 60)), null, 1));
    } catch {
      // sonde best effort
    }
  });
}
