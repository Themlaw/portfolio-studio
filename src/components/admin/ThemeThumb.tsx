"use client";

/* eslint-disable @next/next/no-img-element -- vignette statique déjà à sa taille (WebP généré par npm run theme:thumbs). */
import { useTranslations } from "next-intl";

import { FONT_STACKS } from "@/themes/font-stacks";
import type { Theme } from "@/themes/schema";

/**
 * Vignette d'un thème dans la galerie (Admin → Thèmes).
 * Thème livré : capture réelle de l'accueil (public/themes/<slug>/thumb.webp,
 * générée par `npm run theme:thumbs`). Sinon (copie, import) : maquette
 * miniature dessinée avec les tokens du thème (couleurs, polices, rayons),
 * à jour à chaque enregistrement.
 */
export default function ThemeThumb({ theme, src }: { theme: Theme; src?: string | null }) {
  const t = useTranslations("themeThumb");
  if (src) {
    // Aplat du fond du thème tant que l'image n'est pas arrivée (jamais un rectangle blanc vide).
    return <img className="a-theme-thumb" src={src} alt="" width={480} height={300} loading="lazy" decoding="async" style={{ background: theme.tokens.color.bg }} />;
  }
  const c = theme.tokens.color;
  const f = theme.tokens.font;
  const display = FONT_STACKS[f.display];
  const dark = theme.variants.hero === "spotlight";
  return (
    <div className="a-theme-thumb a-theme-mini" aria-hidden="true" style={{ background: c.bg, color: c.ink, fontFamily: FONT_STACKS[f.body].stack }}>
      <div className="a-theme-mini-bar" style={{ justifyContent: theme.variants.header === "centered" ? "center" : "space-between", borderColor: c.line }}>
        <span style={{ fontFamily: display.stack, fontWeight: display.headingWeight }}>{t("studio")}</span>
        {theme.variants.header === "inline" && <span style={{ fontFamily: FONT_STACKS[f.caption].stack, color: c.inkSoft }}>{t("nav")}</span>}
      </div>
      <div className="a-theme-mini-hero" style={{ textAlign: dark ? "center" : "left", background: c.accentGlow && dark ? `radial-gradient(80% 120% at 50% -30%, color-mix(in srgb, ${c.accentGlow} 33%, transparent), transparent 70%)` : undefined }}>
        <span className="a-theme-mini-eyebrow" style={{ color: c.eyebrow ?? c.secondary, fontFamily: FONT_STACKS[f.caption].stack }}>
          {t("eyebrow")}
        </span>
        <span className="a-theme-mini-title" style={{ fontFamily: display.stack, fontWeight: display.headingWeight }}>
          {t("title")}
        </span>
        <span className="a-theme-mini-btn" style={{ background: c.primary, color: c.onPrimary, borderRadius: theme.variants.button === "pill" ? "999px" : theme.tokens.radius.sm }}>
          {t("view")}
        </span>
      </div>
      <div className="a-theme-mini-strip" style={{ background: c.bgDeep }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              background: i === 1 ? c.tertiary : c.surface,
              borderRadius: theme.tokens.radius.strip,
              transform: theme.variants.strip === "taped" ? `rotate(${[-2, 1.5, -1][i]}deg)` : undefined,
              border: `1px solid ${c.line}`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
