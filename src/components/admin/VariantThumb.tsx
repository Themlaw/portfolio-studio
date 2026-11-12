/**
 * Vignettes schématiques des variantes de forme (SVG en ligne, couleur de
 * texte courante : aucune capture d'écran, aucune couleur littérale).
 */
const W = 96;
const H = 60;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="a-thumb">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="4" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      {children}
    </svg>
  );
}

const bar = (x: number, y: number, w: number, h = 3, o = 0.55) => <rect x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" fillOpacity={o} />;

export const VARIANT_THUMBS: Record<string, Record<string, React.ReactNode>> = {
  header: {
    inline: (
      <Frame>
        {bar(8, 9, 20, 5, 0.8)}
        {bar(48, 10, 9)}
        {bar(61, 10, 9)}
        {bar(74, 10, 12)}
        <line x1="6" x2="90" y1="20" y2="20" stroke="currentColor" strokeOpacity="0.2" />
        {bar(8, 30, 50, 4, 0.3)}
        {bar(8, 38, 36, 4, 0.3)}
      </Frame>
    ),
    centered: (
      <Frame>
        {bar(34, 7, 28, 5, 0.8)}
        {bar(24, 17, 12)}
        {bar(41, 17, 12)}
        {bar(58, 17, 12)}
        <line x1="6" x2="90" y1="25" y2="25" stroke="currentColor" strokeOpacity="0.2" />
        {bar(22, 34, 52, 4, 0.3)}
        {bar(30, 42, 36, 4, 0.3)}
      </Frame>
    ),
  },
  hero: {
    "parallax-layers": (
      <Frame>
        <path d="M1 44 L22 26 L38 38 L58 18 L95 42 L95 59 L1 59 Z" fill="currentColor" fillOpacity="0.18" />
        <path d="M1 52 L18 40 L40 50 L66 34 L95 50 L95 59 L1 59 Z" fill="currentColor" fillOpacity="0.35" />
        {bar(10, 10, 34, 5, 0.8)}
        {bar(10, 18, 22)}
      </Frame>
    ),
    spotlight: (
      <Frame>
        <circle cx="48" cy="30" r="22" fill="currentColor" fillOpacity="0.12" />
        <circle cx="48" cy="30" r="12" fill="currentColor" fillOpacity="0.16" />
        {bar(30, 26, 36, 5, 0.8)}
        {bar(38, 35, 20)}
      </Frame>
    ),
    "type-only": (
      <Frame>
        {bar(8, 12, 80, 8, 0.8)}
        {bar(8, 24, 62, 8, 0.8)}
        <rect x="46" y="24" width="24" height="8" rx="1.5" fill="currentColor" fillOpacity="0.35" />
        {bar(8, 40, 30)}
      </Frame>
    ),
  },
  strip: {
    edge: (
      <Frame>
        <rect x="1" y="18" width="30" height="24" fill="currentColor" fillOpacity="0.3" />
        <rect x="33" y="18" width="30" height="24" fill="currentColor" fillOpacity="0.45" />
        <rect x="65" y="18" width="30" height="24" fill="currentColor" fillOpacity="0.3" />
      </Frame>
    ),
    taped: (
      <Frame>
        <g transform="rotate(-4 22 30)">
          <rect x="8" y="18" width="28" height="24" fill="currentColor" fillOpacity="0.3" />
          <rect x="16" y="14" width="12" height="6" fill="currentColor" fillOpacity="0.55" />
        </g>
        <g transform="rotate(3 60 30)">
          <rect x="46" y="18" width="28" height="24" fill="currentColor" fillOpacity="0.45" />
          <rect x="54" y="14" width="12" height="6" fill="currentColor" fillOpacity="0.7" />
        </g>
      </Frame>
    ),
  },
  caption: {
    "mono-split": (
      <Frame>
        <rect x="14" y="8" width="68" height="32" fill="currentColor" fillOpacity="0.25" />
        {bar(14, 46, 22, 2.5)}
        {bar(64, 46, 18, 2.5)}
      </Frame>
    ),
    handwritten: (
      <Frame>
        <rect x="14" y="8" width="68" height="32" fill="currentColor" fillOpacity="0.25" />
        <path d="M16 50 q4 -6 8 0 t8 0 t8 0 t8 0" fill="none" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.6" strokeLinecap="round" />
      </Frame>
    ),
  },
  lightbox: {
    "passe-partout": (
      <Frame>
        <rect x="1" y="1" width="94" height="58" rx="4" fill="currentColor" fillOpacity="0.12" />
        <rect x="24" y="10" width="48" height="40" fill="currentColor" fillOpacity="0.45" />
      </Frame>
    ),
    "full-bleed": (
      <Frame>
        <rect x="1" y="1" width="94" height="58" rx="4" fill="currentColor" fillOpacity="0.45" />
        {bar(8, 50, 24, 2.5, 0.8)}
      </Frame>
    ),
  },
  button: {
    pill: (
      <Frame>
        <rect x="18" y="20" width="60" height="20" rx="10" fill="currentColor" fillOpacity="0.7" />
      </Frame>
    ),
    square: (
      <Frame>
        <rect x="18" y="20" width="60" height="20" rx="1" fill="currentColor" fillOpacity="0.7" />
      </Frame>
    ),
  },
  texture: {
    none: (
      <Frame>
        {bar(12, 14, 50, 4, 0.3)}
        {bar(12, 22, 36, 4, 0.3)}
      </Frame>
    ),
    "paper-dots": (
      <Frame>
        <pattern id="a-dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.9" fill="currentColor" fillOpacity="0.45" />
        </pattern>
        <rect x="1" y="1" width="94" height="58" rx="4" fill="url(#a-dots)" />
        {bar(12, 14, 50, 4, 0.3)}
        {bar(12, 22, 36, 4, 0.3)}
      </Frame>
    ),
  },
};

/** Les options de chaque réglage (les libellés viennent du catalogue `variants`). */
const VARIANT_OPTIONS: Record<string, string[]> = {
  header: ["inline", "centered"],
  hero: ["parallax-layers", "spotlight", "type-only"],
  strip: ["edge", "taped"],
  caption: ["mono-split", "handwritten"],
  lightbox: ["passe-partout", "full-bleed"],
  button: ["pill", "square"],
  texture: ["none", "paper-dots"],
};

/** Libellés des réglages de forme, dans la langue de `t` (`useTranslations("variants")`). */
export function variantLabels(t: (key: string) => string): Record<string, { title: string; help: string; options: Record<string, string> }> {
  return Object.fromEntries(
    Object.entries(VARIANT_OPTIONS).map(([k, opts]) => [k, { title: t(`${k}.title`), help: t(`${k}.help`), options: Object.fromEntries(opts.map((o) => [o, t(`${k}.options.${o}`)])) }]),
  );
}
