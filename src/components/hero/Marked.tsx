/**
 * Rend un texte où <mark>…</mark> signale un mot mis en valeur (.hero-mark).
 * Aucun HTML n'est interprété : seul ce balisage est reconnu, le reste est du texte.
 */
export default function Marked({ text }: { text: string }) {
  const parts = text.split(/<mark>(.*?)<\/mark>/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="hero-mark">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
