import type { Theme } from "@/themes/schema";

/** Miniature des couleurs d'un thème (fond, surface, encre, accents). */
export default function ThemeSwatches({ theme }: { theme: Theme }) {
  const c = theme.tokens.color;
  const swatches: [string, string][] = [
    ["Fond", c.bg],
    ["Surface", c.surface],
    ["Encre", c.ink],
    ["Action", c.primary],
    ["Étiquettes", c.eyebrow ?? c.secondary],
    ["Détails", c.tertiary],
  ];
  return (
    <div className="a-swatches" role="img" aria-label={`Couleurs du thème ${theme.name}`}>
      {swatches.map(([label, value]) => (
        <span key={label} className="a-swatch" title={`${label} ${value}`} style={{ background: value }} />
      ))}
    </div>
  );
}
