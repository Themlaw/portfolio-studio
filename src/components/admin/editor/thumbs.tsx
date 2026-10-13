/**
 * Vignettes schématiques des types de blocs (palette « Ajouter ») : formes
 * neutres aux couleurs de l'admin, jamais une capture du thème.
 */
const INK = "var(--admin-ink-soft)";
const SOFT = "var(--admin-line-strong)";
const ACCENT = "var(--admin-accent)";

function Lines({ x, y, w, n, gap = 6 }: { x: number; y: number; w: number; n: number; gap?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x} y={y + i * gap} width={i === n - 1 ? w * 0.6 : w} height="2.5" rx="1.2" fill={SOFT} />
      ))}
    </>
  );
}

const THUMBS: Record<string, React.ReactNode> = {
  "featured-project": (
    <>
      <rect x="6" y="5" width="84" height="50" rx="3" fill="none" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="12" y="11" width="34" height="5" rx="2" fill={INK} />
      {[12, 32, 52, 72].map((x) => (
        <rect key={x} x={x} y="22" width="17" height="26" rx="1.5" fill={SOFT} />
      ))}
    </>
  ),
  grid: (
    <>
      <rect x="10" y="8" width="76" height="22" rx="2" fill={SOFT} />
      <rect x="10" y="34" width="36" height="18" rx="2" fill={SOFT} />
      <rect x="50" y="34" width="36" height="18" rx="2" fill={SOFT} />
    </>
  ),
  cv: (
    <>
      <rect x="10" y="9" width="22" height="4" rx="2" fill={INK} />
      <Lines x={10} y={17} w={22} n={2} />
      <rect x="10" y="38" width="24" height="8" rx="2" fill={ACCENT} />
      <rect x="44" y="6" width="20" height="28" rx="1.5" fill="none" stroke={SOFT} strokeWidth="1.5" />
      <Lines x={47} y={11} w={14} n={3} gap={5} />
      <rect x="68" y="6" width="20" height="28" rx="1.5" fill="none" stroke={SOFT} strokeWidth="1.5" />
      <Lines x={71} y={11} w={14} n={3} gap={5} />
    </>
  ),
  "video-single": (
    <>
      <rect x="14" y="8" width="68" height="40" rx="2" fill={INK} />
      <path d="M44 20 56 28 44 36Z" fill="var(--admin-bg)" />
    </>
  ),
  image: (
    <>
      <rect x="14" y="8" width="68" height="40" rx="2" fill={SOFT} />
      <path d="M20 44 38 26 50 38 58 31 76 44Z" fill={INK} />
    </>
  ),
  "contact-form": (
    <>
      <rect x="12" y="8" width="40" height="5" rx="2" fill={INK} />
      {[18, 28].map((y) => (
        <rect key={y} x="12" y={y} width="56" height="7" rx="1.5" fill="none" stroke={SOFT} strokeWidth="1.5" />
      ))}
      <rect x="12" y="38" width="56" height="10" rx="1.5" fill="none" stroke={SOFT} strokeWidth="1.5" />
      <rect x="12" y="51" width="22" height="5" rx="2" fill={ACCENT} />
    </>
  ),
  "section-title": (
    <>
      <rect x="10" y="14" width="24" height="3" rx="1.5" fill={ACCENT} />
      <rect x="10" y="22" width="60" height="8" rx="2" fill={INK} />
      <Lines x={10} y={38} w={56} n={2} />
    </>
  ),
  hero: (
    <>
      <rect x="10" y="12" width="30" height="3" rx="1.5" fill={ACCENT} />
      <rect x="10" y="20" width="62" height="8" rx="2" fill={INK} />
      <rect x="10" y="32" width="48" height="8" rx="2" fill={INK} />
      <Lines x={10} y={46} w={40} n={1} />
    </>
  ),
  "collection-tiles": (
    <>
      <rect x="10" y="8" width="36" height="5" rx="2" fill={INK} />
      {[10, 37, 64].map((x) => (
        <rect key={x} x={x} y="18" width="23" height="32" rx="2" fill={SOFT} />
      ))}
    </>
  ),
  "featured-projects": (
    <>
      <rect x="10" y="8" width="40" height="5" rx="2" fill={INK} />
      {[0, 1].map((r) => (
        <g key={r}>
          {[10, 32, 54, 76].map((x) => (
            <rect key={x} x={x} y={20 + r * 17} width="19" height="13" rx="1.5" fill={SOFT} />
          ))}
        </g>
      ))}
    </>
  ),
  "collection-intro": (
    <>
      <rect x="10" y="12" width="20" height="3" rx="1.5" fill={ACCENT} />
      <rect x="10" y="20" width="56" height="10" rx="2" fill={INK} />
      <Lines x={10} y={36} w={60} n={2} />
    </>
  ),
  "collection-projects": (
    <>
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x="10" y={8 + r * 16} width="22" height="3" rx="1.5" fill={INK} />
          {[10, 31, 52, 73].map((x) => (
            <rect key={x} x={x} y={13 + r * 16} width="18" height="8" rx="1" fill={SOFT} />
          ))}
        </g>
      ))}
    </>
  ),
  video: (
    <>
      <rect x="10" y="8" width="76" height="30" rx="2" fill={SOFT} />
      <path d="M44 16 L56 23 L44 30 Z" fill={INK} />
      {[10, 37, 64].map((x) => (
        <rect key={x} x={x} y="43" width="22" height="10" rx="1.5" fill={SOFT} />
      ))}
    </>
  ),
  "rich-text": (
    <>
      <rect x="10" y="10" width="44" height="7" rx="2" fill={INK} />
      <Lines x={10} y={24} w={70} n={4} />
    </>
  ),
  contact: (
    <>
      <rect x="8" y="8" width="80" height="44" rx="3" fill="none" stroke={SOFT} strokeWidth="1.5" />
      <rect x="28" y="16" width="40" height="6" rx="2" fill={INK} />
      <Lines x={26} y={27} w={44} n={1} />
      <rect x="36" y="36" width="24" height="8" rx="4" fill={ACCENT} />
    </>
  ),
  profile: (
    <>
      <rect x="10" y="8" width="28" height="40" rx="2" fill={SOFT} />
      <rect x="46" y="10" width="20" height="3" rx="1.5" fill={ACCENT} />
      <Lines x={46} y={18} w={40} n={4} />
    </>
  ),
};

export default function BlockThumb({ type, preset }: { type: string; preset?: string }) {
  // Rubriques de texte proposées en premier (« Ajouter une rubrique », lot 17c).
  if (preset === "text" || preset === "title" || preset === "title-text")
    return (
      <svg className="ve-thumb" viewBox="0 0 96 60" width="96" height="60" aria-hidden="true">
        <rect width="96" height="60" rx="4" fill="var(--admin-bg)" />
        {preset === "title" ? (
          <>
            <rect x="10" y="12" width="26" height="4" rx="2" fill={ACCENT} />
            <rect x="10" y="22" width="60" height="10" rx="2" fill={INK} />
          </>
        ) : preset === "title-text" ? (
          <>
            <rect x="10" y="9" width="44" height="7" rx="2" fill={INK} />
            <Lines x={10} y={24} w={72} n={4} />
          </>
        ) : (
          <Lines x={10} y={13} w={72} n={6} gap={7} />
        )}
      </svg>
    );
  if (preset === "grid-videos")
    return (
      <svg className="ve-thumb" viewBox="0 0 96 60" width="96" height="60" aria-hidden="true">
        <rect width="96" height="60" rx="4" fill="var(--admin-bg)" />
        <rect x="10" y="6" width="76" height="24" rx="2" fill={INK} />
        <rect x="10" y="34" width="36" height="20" rx="2" fill={INK} />
        <rect x="50" y="34" width="36" height="20" rx="2" fill={INK} />
      </svg>
    );
  return (
    <svg className="ve-thumb" viewBox="0 0 96 60" width="96" height="60" aria-hidden="true">
      <rect width="96" height="60" rx="4" fill="var(--admin-bg)" />
      {Object.hasOwn(THUMBS, type) ? THUMBS[type] : <Lines x={10} y={14} w={70} n={5} />}
    </svg>
  );
}
