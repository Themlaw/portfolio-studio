import { parseMarked } from "@/lib/marked";

/**
 * Rend un texte où <mark>…</mark> signale un mot mis en valeur (.hero-mark).
 * Aucun HTML n'est interprété : seul ce balisage est reconnu, le reste est du texte.
 *
 * Vue brouillon de l'éditeur (`edit`) : le contenu est dans UN enveloppe
 * (`data-marked-body`). La toile ne touche jamais aux nœuds que React gère ici :
 * elle cache l'enveloppe et montre à côté son aperçu ou son champ de saisie
 * (src/components/edit/optimistic.ts, EditLayer), puis retire le tout.
 */
export default function Marked({ text, edit, placeholder }: { text: string; edit?: boolean; placeholder?: string }) {
  const body = parseMarked(text).map((p, i) =>
    p.mark ? (
      <span key={i} className="hero-mark">
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
  if (edit) return <span data-marked-body="" data-placeholder={placeholder}>{body}</span>;
  return <>{body}</>;
}
