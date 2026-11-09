// Chemin du kit en cache d'un thème prédéfini pour le dossier de données DATA_DIR (base déjà migrée) : imprime le chemin du .zip.
const m = await import("../../src/lib/kit/export-job.ts");
const t = m.loadSavedTheme(process.argv[2]);
if (!t) { console.error("thème inconnu"); process.exit(1); }
console.log(m.kitFile(t.id, m.kitVersion(t)));
