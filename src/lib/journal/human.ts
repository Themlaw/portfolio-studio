/**
 * Phrases du journal (lot 97) : « Nom du site modifié depuis la page Décors : brouillon ».
 * Module pur, testé par scripts/test-journal97.mjs.
 */
import type { Change } from "./summary";

type Subject = { label: string; f?: boolean };

const BLOCKS: Record<string, string> = {
  "project-board": "Projet",
  "featured-project": "Projet mis en avant",
  "featured-projects": "Projets mis en avant",
  "video-single": "Vidéo",
  video: "Vidéo",
  grid: "Grille",
  image: "Image",
  "free-board": "Planche libre",
  cv: "CV",
  "section-title": "Titre",
  hero: "Ouverture",
  "collection-tiles": "Entrées des collections",
  "collection-intro": "En-tête de collection",
  "collection-projects": "Projets d'une collection",
  "rich-text": "Texte",
  contact: "Contact",
  "contact-form": "Formulaire de contact",
  "page-link": "Lien vers une page",
  profile: "Profil",
};

const RULES: [RegExp, (m: RegExpExecArray) => Subject][] = [
  [/^blocks\[([a-z0-9-]+):/, (m) => ({ label: `Bloc « ${BLOCKS[m[1]] ?? m[1]} »` })],
  [/^blocks/, () => ({ label: "Ordre des blocs" })],
  [/^title(\.|$)/, () => ({ label: "Titre de la page" })],
  [/^slug(\.|$)/, () => ({ label: "Adresse de la page", f: true })],
  [/^meta\.title/, () => ({ label: "Titre pour les moteurs de recherche" })],
  [/^meta\.description/, () => ({ label: "Description de la page", f: true })],
  [/^meta\.image/, () => ({ label: "Image de partage", f: true })],
  [/^published/, () => ({ label: "Mise en ligne de la page", f: true })],
  [/^inMenu/, () => ({ label: "Présence dans le menu", f: true })],
  [/^accent/, () => ({ label: "Couleur d'accent", f: true })],
  [/^wallpaper/, () => ({ label: "Papier peint de la page" })],
  [/^collection/, () => ({ label: "Collection de la page", f: true })],
  [/^identity\.name/, () => ({ label: "Nom du site" })],
  [/^identity\.role/, () => ({ label: "Métier du site" })],
  [/^identity\.credit/, () => ({ label: "Crédit du pied de page" })],
  [/^identity\.email/, () => ({ label: "Adresse e-mail de contact", f: true })],
  [/^identity\.headerSocials/, () => ({ label: "Réseaux dans l'en-tête" })],
  [/^identity/, () => ({ label: "Identité du site", f: true })],
  [/^nav/, () => ({ label: "Menu" })],
  [/^socials/, () => ({ label: "Réseaux" })],
  [/^styles\.logo/, () => ({ label: "Logo" })],
  [/^styles/, () => ({ label: "Style du site" })],
];

export function subjectOf(path: string): Subject {
  for (const [re, f] of RULES) {
    const m = re.exec(path);
    if (m) return f(m);
  }
  return { label: path ? `Champ « ${path.split(/[.[]/)[0]} »` : "Contenu" };
}

/** « Nom du site modifié », « Titre de la page, Adresse de la page modifiés »… (au plus 3, puis « et N autres »). */
export function describeChanges(changes: Change[]): string {
  const seen = new Map<string, { s: Subject; verb: string }>();
  for (const c of changes) {
    const s = subjectOf(c.p);
    const verb = c.note === "ajouté" ? "ajouté" : c.note === "retiré" ? "retiré" : "modifié";
    const k = `${s.label}|${verb}`;
    if (!seen.has(k)) seen.set(k, { s, verb });
  }
  const items = [...seen.values()];
  if (!items.length) return "Contenu modifié";
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  if (shown.length === 1 && !more) {
    const { s, verb } = shown[0];
    return `${s.label} ${verb}${s.f ? "e" : ""}`;
  }
  const verbs = new Set(shown.map((x) => x.verb));
  const verb = verbs.size === 1 ? [...verbs][0] : "modifié";
  return `${shown.map((x) => x.s.label).join(", ")}${more ? ` et ${more} autre${more > 1 ? "s" : ""}` : ""} ${verb}s`;
}

/** Phrase finale d'une entrée d'action. */
export function sentence(o: { what: string; page: string | null; state?: string | null; result: "ok" | "refus" | "conflit" | "erreur"; reason?: string | null }): string {
  let s = o.what;
  if (o.page) s += ` depuis la page ${o.page}`;
  if (o.state) s += ` : ${o.state}`;
  if (o.result === "conflit") s += " — refusé, la page avait été modifiée ailleurs";
  else if (o.result === "refus") s += ` — refusé${o.reason ? ` : ${o.reason}` : ""}`;
  else if (o.result === "erreur") s += ` — erreur${o.reason ? ` : ${o.reason}` : ""}`;
  return s;
}
