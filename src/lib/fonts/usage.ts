/**
 * Où chaque police téléchargée est utilisée : styles du site (publiés et
 * brouillon), réglages de texte des blocs (`look.text`, versions publiées et
 * brouillons des pages, composants des conteneurs compris) et thèmes. Lecture
 * directe en base (texte JSON, sans cache) : sert au quota de la bibliothèque,
 * au ramasse-miettes et à l'écran « Polices téléchargées ».
 */
import { getSqlite } from "../db";
import { familiesIn } from "./faces";

export type FontUsage = Map<string, string[]>;

export function fontUsage(): FontUsage {
  const db = getSqlite();
  const out: FontUsage = new Map();
  const add = (json: string | null | undefined, where: string) => {
    if (!json) return;
    for (const f of familiesIn(json)) out.set(f, [...new Set([...(out.get(f) ?? []), where])]);
  };
  const title = (t: string) => {
    try {
      const v = JSON.parse(t) as { fr?: string };
      return v.fr || "sans titre";
    } catch {
      return "sans titre";
    }
  };
  for (const r of db.prepare("select key, value from settings where key in ('styles', 'siteDraft')").all() as { key: string; value: string }[]) {
    add(r.value, r.key === "styles" ? "styles du site" : "brouillon du site");
  }
  const pages = db.prepare("select id, title, draft from pages").all() as { id: number; title: string; draft: string | null }[];
  for (const p of pages) {
    const name = `« ${title(p.title)} »`;
    for (const b of db.prepare("select props from blocks where page_id = ?").all(p.id) as { props: string }[]) add(b.props, `page ${name}`);
    add(p.draft, `brouillon de ${name}`);
  }
  for (const t of db.prepare("select name, data from themes").all() as { name: string; data: string }[]) add(t.data, `thème « ${t.name} »`);
  return out;
}
