import { BASE_KEYS, ROLE_NAMES } from "@/themes/palette";
import type { Theme } from "@/themes/schema";

/** Miniature des couleurs d'un thème (les six rôles de la palette). */
export default function ThemeSwatches({ theme }: { theme: Theme }) {
  const c = theme.tokens.color;
  // Les six rôles, dans l'ordre et sous le nom du panneau « Couleurs » (`ROLE_NAMES`).
  const swatches: [string, string][] = BASE_KEYS.map((k) => [ROLE_NAMES[k], c[k]]);

  return (
    <div className="a-swatches" role="img" aria-label={`Couleurs du thème ${theme.name}`}>
      {swatches.map(([label, value]) => (
        <span key={label} className="a-swatch" title={`${label} ${value}`} style={{ background: value }} />
      ))}
    </div>
  );
}
