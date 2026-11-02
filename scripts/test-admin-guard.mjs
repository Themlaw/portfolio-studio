#!/usr/bin/env node
/**
 * Garde des server actions de l'admin (analyse statique).
 *
 * Règle : toute server action définie sous src/app/admin ou src/components/admin
 * — fonction exportée d'un fichier "use server", ou fonction marquée
 * "use server" en ligne — commence par `await assertAdmin()`. De même pour les
 * gestionnaires mutants (POST, PUT, PATCH, DELETE) des route.ts de src/app/admin.
 * Échoue aussi si aucune action n'est trouvée (test qui ne vérifierait rien).
 * Usage : node scripts/test-admin-guard.mjs   (inclus dans npm test)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["src/app/admin", "src/components/admin"];
const GUARD = /^\s*(?:const\s+(?:\w+|\{[^}]*\})\s*=\s*)?await\s+assertAdmin\(\)\s*;/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Corps d'une fonction à partir de l'accolade ouvrante (appariement simple). */
function bodyAfter(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(openIndex + 1, i);
  }
  return "";
}

/**
 * Index de l'accolade ouvrante du CORPS d'une fonction, à partir de la
 * parenthèse ouvrante de ses paramètres : saute les paramètres puis un
 * éventuel type de retour (qui peut contenir des accolades :
 * Promise<Result<{ id: number }>>). En cas de doute, renvoie une accolade
 * trop tôt : le test échoue (jamais de faux succès).
 */
function bodyOpen(source, parenIndex) {
  let depth = 0;
  let i = parenIndex;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) break;
  }
  depth = 0;
  for (i++; i < source.length; i++) {
    const c = source[i];
    if (c === "=" && source[i + 1] === ">") {
      if (depth === 0) {
        // Fonction fléchée : le corps suit.
        const j = source.indexOf("{", i);
        return j;
      }
      i++;
      continue;
    }
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "{") {
      if (depth === 0) return i;
      depth++;
    } else if (c === "}") depth--;
  }
  return -1;
}

/**
 * Actions connues : chacune doit être trouvée ET gardée. Une action ajoutée
 * est vérifiée automatiquement ; cette liste détecte en plus une action
 * que l'analyse ne verrait plus (régression du test lui-même).
 */
const EXPECTED = [
  "signOutAction",
  "duplicateThemeAction",
  "saveThemeAction",
  "activateThemeAction",
  "deleteThemeAction",
  "resetSiteColorsAction",
  "applyModelAction",
  "revertVersionAction",
  "keepVersionCopyAction",
  "pinVersionAction",
  "adoptOldThemeAction",
  "closeEditSessionAction",
  "importThemeLogoAction",
  "saveSettingsAction",
  "saveSeoAction",
  "markMessagesSeenAction",
  "setOnboardingHiddenAction",
  "createPageAction",
  "savePageInfoAction",
  "setPublishedAction",
  "setInMenuAction",
  "addToMenuFromEditorAction",
  "reorderMenuAction",
  "deletePageAction",
  "restorePageAction",
  "purgeTrashItemAction",
  "emptyTrashAction",
  "deleteMessageAction",
  "deleteAllMessagesAction",
  "siteDraftAction",
  "installFontAction",
  "deleteFontAction",
  "createProjectAction",
  "saveProjectAction",
  "reorderProjectsAction",
  "deleteProjectAction",
  "restoreProjectAction",
  "addSlotsAction",
  "saveSlotAction",
  "setSlotMediaAction",
  "deleteSlotAction",
  "reorderSlotsAction",
  "saveMediaAltAction",
  "deleteMediaAction",
  "restoreMediaAction",
  "mediaStatusAction",
  "mediaUsesAction",
  "retryMediaAction",
  "pendingUploadsAction",
  "listTagsAction",
  "setMediaTagsAction",
  "addMediaTagsAction",
  "removeMediaTagsAction",
  "renameTagAction",
  "mergeTagsAction",
  "deleteTagAction",
  "deleteUnusedTagsAction",
  "createWallpaperAction",
  "renameWallpaperAction",
  "saveWallpaperPaintAction",
  "wallpaperUsesAction",
  "trashWallpaperAction",
  "restoreWallpaperAction",
  "saveCardWallpaperAction",
  "saveThemeFrameAllAction",
  "listWallpapersAction",
];
const found = new Set();

const failures = [];
let checked = 0;

for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const fileLevel = /^\s*["']use server["'];?/.test(src);

    if (fileLevel) {
      // Toute fonction exportée d'un fichier "use server" est une server action.
      const exportFn = /export\s+(?:default\s+)?async\s+function\s+(\w+)\s*\(/g;
      const exportArrow = /export\s+const\s+(\w+)\s*=\s*async\s*\(/g;
      // Lot 97 : `export const nom = audited("nom", async function nom(…) { await assertAdmin(); … })` (journal d'édition).
      const exportAudited = /export\s+const\s+(\w+)\s*=\s*audited\(\s*"\1"\s*,\s*async\s+function\s+\1\s*\(/g;
      for (const re of [exportFn, exportArrow, exportAudited]) {
        for (const m of src.matchAll(re)) {
          checked++;
          found.add(m[1]);
          const open = bodyOpen(src, m.index + m[0].length - 1);
          const body = open < 0 ? "" : bodyAfter(src, open);
          if (!GUARD.test(body)) failures.push(`${rel} : action « ${m[1]} » sans \`await assertAdmin()\` en première instruction`);
        }
      }
      if (/export\s+(?:const|let)\s+\w+\s*=(?!\s*async\b)(?!\s*audited\(\s*"\w+"\s*,\s*async\s+function\b)/.test(src)) {
        failures.push(`${rel} : un fichier "use server" ne doit exporter que des fonctions async gardées`);
      }
    }

    // Routes mutantes de l'admin.
    if (/\/route\.tsx?$/.test(rel)) {
      // Lot 97 : `export const POST = auditedRoute("nom", async function POST(…) { await assertAdmin(); … })` est un gestionnaire async comme les autres.
      for (const m of src.matchAll(/export\s+(?:async\s+function\s+|const\s+)(POST|PUT|PATCH|DELETE)\s*(?:=\s*auditedRoute\(\s*"[\w-]+"\s*,\s*async\s+function\s+\1\s*)?\(/g)) {
        checked++;
        const open = bodyOpen(src, m.index + m[0].length - 1);
        const body = open < 0 ? "" : bodyAfter(src, open);
        if (!GUARD.test(body)) failures.push(`${rel} : route ${m[1]} sans \`await assertAdmin()\` en première instruction`);
      }
      if (/export\s+(?:const|function)\s+(POST|PUT|PATCH|DELETE)\b(?![\s\S]*?async)/.test(src) || /export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=(?!\s*auditedRoute\()/.test(src)) {
        failures.push(`${rel} : gestionnaire mutant non async (garde impossible à vérifier)`);
      }
    }

    // Actions en ligne : fonction dont la première instruction est "use server".
    for (const m of src.matchAll(/\{\s*["']use server["'];?/g)) {
      checked++;
      const after = src.slice(m.index + m[0].length);
      if (!GUARD.test(after)) failures.push(`${rel} : action en ligne sans \`await assertAdmin()\` juste après "use server"`);
    }
  }
}

// Routes GET de l'admin qui lisent des données privées : gardées elles aussi.
const GUARDED_GET = ["src/app/admin/api/themes/[id]/export/route.ts", "src/app/admin/api/fonts/preview/route.ts"];
for (const rel of GUARDED_GET) {
  let src = "";
  try {
    src = readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  } catch {
    failures.push(`${rel} : route GET attendue introuvable (mettre à jour GUARDED_GET)`);
    continue;
  }
  const m = /export\s+async\s+function\s+GET\s*\(/.exec(src);
  if (!m) {
    failures.push(`${rel} : pas de GET async`);
    continue;
  }
  checked++;
  const open = bodyOpen(src, m.index + m[0].length - 1);
  if (!GUARD.test(open < 0 ? "" : bodyAfter(src, open))) failures.push(`${rel} : route GET sans \`await assertAdmin()\` en première instruction`);
}

for (const name of EXPECTED) {
  if (!found.has(name)) failures.push(`action attendue « ${name} » introuvable (supprimée ? renommée ? mettre à jour EXPECTED)`);
}
// Le thème en ligne ne s'enregistre pas sans confirmation vérifiée CÔTÉ SERVEUR (v0.18.1) : l'action transmet `confirmLive`
// et saveTheme refuse sans lui quand le thème est l'actif.
{
  const act = readFileSync(join(ROOT, "src/app/admin/(espace)/themes/actions.ts"), "utf8");
  const lib = readFileSync(join(ROOT, "src/lib/edit/themes.ts"), "utf8");
  if (!/saveThemeAction\(id: unknown, input: unknown, confirmLive\?: unknown\)/.test(act) || !/saveTheme\(tid, input, confirmLive === true\)/.test(act)) failures.push("saveThemeAction : le champ confirmLive n'est plus transmis à saveTheme");
  if (!/activeThemeId\(\) === id && confirmLive !== true/.test(lib)) failures.push("saveTheme : le refus du thème en ligne sans confirmLive a disparu");
}
if (checked === 0) failures.push("aucune server action trouvée : le test ne vérifie rien (chemins à revoir ?)");

if (failures.length) {
  console.error("test-admin-guard : ÉCHEC");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`test-admin-guard : OK (${checked} server action(s) et route(s) mutante(s) gardée(s))`);
