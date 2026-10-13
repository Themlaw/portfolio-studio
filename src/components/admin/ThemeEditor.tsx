"use client";

/**
 * Éditeur de thème : réglages à gauche, aperçu en direct à droite (cadre de
 * l'accueil en draft mode, mis à jour par postMessage sans rechargement ; il
 * est rechargé après chaque enregistrement pour les formes rendues côté
 * serveur). Sous 1100px, l'aperçu passe dans un onglet.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { saveThemeAction } from "@/app/admin/(espace)/themes/actions";
import { contrastReport } from "@/themes/contrast";
import { themeTypeCss } from "@/lib/look";
import { themeAttributes, themeToCss } from "@/themes/css";
import { FONT_STACKS } from "@/themes/font-stacks";
import { contrastRatio, normalizePalette, resolvePalette } from "@/themes/palette";
import { FONT_IDS, type FontId, type Theme } from "@/themes/schema";

import { clone, SaveBar, same, toast, useUnsavedGuard } from "./editing";
import CursorSettings from "./CursorSettings";
import PaperSettings from "./PaperSettings";
import KitDownloadButton from "./KitDownloadButton";
import PaletteEditor from "./PaletteEditor";
import type { SitePalette } from "@/lib/look";
import { SITE_ROLES } from "@/themes/site-palette";
import ThemeTypeEditor from "./ThemeTypeEditor";
import { VARIANT_LABELS, VARIANT_THUMBS } from "./VariantThumb";

/* ---- Réglettes ----------------------------------------------------------- */

function Slider({
  label,
  help,
  min,
  max,
  step,
  value,
  unit,
  onChange,
}: {
  label: string;
  help?: string;
  min: number;
  max: number;
  step: number;
  value: number | null;
  unit: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const v = value ?? min;
  return (
    <div className="a-field a-slider">
      <label htmlFor={id}>
        {label}
        <output htmlFor={id} className="mono">
          {value === null ? "personnalisé" : `${v}${unit}`}
        </output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(Number(e.target.value))} />
      {help && <p className="a-help">{help}</p>}
    </div>
  );
}

const px = (v: string) => (/^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : null);
const CLAMP = /^clamp\(([\d.]+)rem,\s*(\d+)vw,\s*([\d.]+)rem\)$/;
const clampMax = (v: string) => {
  const m = CLAMP.exec(v);
  return m ? parseFloat(m[3]) : null;
};

/* ---- Aperçu ------------------------------------------------------------- */

function Preview({ theme, themeId, reloadKey }: { theme: Theme; themeId: string; reloadKey: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [scale, setScale] = useState(0.5);
  const width = device === "desktop" ? 1280 : 390;
  const frameName = `apercu-${themeId}`;

  // Chargement (et rechargement après enregistrement) : formulaire natif vers
  // /admin/apercu, cible = le cadre. Draft mode + ce thème, sur l'accueil.
  useEffect(() => {
    form.current?.submit();
  }, [reloadKey]);

  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "portfolio:theme", css: [themeToCss(theme), themeTypeCss(theme)].filter(Boolean).join("\n"), attrs: themeAttributes(theme) },
      window.location.origin,
    );
  }, [theme]);

  useEffect(() => {
    const t = setTimeout(send, 60);
    return () => clearTimeout(t);
  }, [send]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.source === frame.current?.contentWindow && e.data?.type === "portfolio:ready") send();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div className="a-preview">
      <div className="a-preview-bar">
        <span className="muted">Aperçu de l&apos;accueil, visible par toi seul</span>
        <div className="a-seg" role="group" aria-label="Largeur de l'aperçu">
          <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
            Ordinateur
          </button>
          <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>
            Mobile
          </button>
        </div>
      </div>
      <form ref={form} method="post" action="/admin/apercu" target={frameName} hidden>
        <input type="hidden" name="id" value={themeId} />
        <input type="hidden" name="retour" value="/admin/themes" />
      </form>
      <div ref={box} className="a-preview-box">
        <iframe
          ref={frame}
          name={frameName}
          title="Aperçu du thème sur l'accueil"
          className="a-preview-frame"
          style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}

/* ---- Éditeur ------------------------------------------------------------ */

export default function ThemeEditor({ initial, isActive, sitePalette = {} }: { initial: Theme; isActive: boolean; sitePalette?: SitePalette }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [theme, setTheme] = useState(() => clone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [tab, setTab] = useState<"reglages" | "apercu">("reglages");
  const [reloadKey, setReloadKey] = useState(0);
  const dirty = !same(theme, saved);
  useUnsavedGuard(dirty);

  const colors = theme.tokens.color;
  const setPalette = (color: Theme["tokens"]["color"], palette: Theme["tokens"]["palette"]) =>
    setTheme((t) => {
      const tokens = { ...t.tokens, color };
      if (palette) tokens.palette = palette;
      else delete tokens.palette;
      return { ...t, tokens };
    });
  const setTokens = <K extends keyof Theme["tokens"]>(k: K, v: Partial<Theme["tokens"][K]>) =>
    setTheme((t) => ({ ...t, tokens: { ...t.tokens, [k]: { ...t.tokens[k], ...v } } }));

  // Même contrôle que le serveur (nuances auto recalculées), plus le texte posé sur le voile.
  const contrastFailures = useMemo(() => {
    const normalized = normalizePalette(colors, theme.tokens.palette);
    const p = resolvePalette(colors, theme.tokens.palette);
    return contrastReport(normalized).some((x) => !x.ok) || contrastRatio(p.onScrim, p.scrim) < 4.5;
  }, [colors, theme.tokens.palette]);

  const save = () => {
    if (contrastFailures) {
      setError("Contraste insuffisant : corrige les couleurs signalées (bouton « Ajuster ») avant d'enregistrer.");
      return;
    }
    startSaving(async () => {
      const result = await saveThemeAction(initial.id, theme);
      if (!result.ok) {
        setError(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      setError(null);
      setErrors({});
      setSaved(clone(theme));
      setReloadKey((k) => k + 1);
      toast(isActive ? "Enregistré · en ligne pour tes visiteurs" : "Enregistré");
      // Hors de la transition : l'état « Enregistré » s'affiche sans attendre le rafraîchissement.
      setTimeout(() => router.refresh(), 0);
    });
  };

  const tabsId = useId();

  return (
    <div className="a-theme-editor" data-tab={tab}>
      <div className="a-tabs a-theme-tabs" role="tablist" aria-label="Éditeur de thème">
        <button type="button" role="tab" id={`${tabsId}-r`} aria-selected={tab === "reglages"} aria-controls={`${tabsId}-rp`} onClick={() => setTab("reglages")}>
          Réglages
        </button>
        <button type="button" role="tab" id={`${tabsId}-a`} aria-selected={tab === "apercu"} aria-controls={`${tabsId}-ap`} onClick={() => setTab("apercu")}>
          Aperçu
        </button>
      </div>

      <div className="a-theme-cols">
        <div className="a-theme-settings" id={`${tabsId}-rp`} role="tabpanel" aria-labelledby={`${tabsId}-r`}>
          <section className="a-panel" aria-labelledby="t-nom">
            <h2 id="t-nom">Nom</h2>
            <div className={`a-field${errors.name ? " a-field-invalid" : ""}`}>
              <label htmlFor="theme-name">Nom du thème</label>
              <input id="theme-name" className="a-input" value={theme.name} maxLength={60} onChange={(e) => setTheme((t) => ({ ...t, name: e.target.value }))} />
              <p className="a-help">Visible seulement dans l&apos;administration.</p>
              {errors.name && <p className="a-field-error">{errors.name}</p>}
            </div>
          </section>

          <section className="a-panel" aria-labelledby="t-couleurs">
            <h2 id="t-couleurs">Palette</h2>
            {Object.keys(sitePalette).length > 0 && (
              <div className="a-notice" role="note" data-testid="site-palette-notice">
                <p>
                  Le site remplace {Object.keys(sitePalette).length > 1 ? "des couleurs" : "une couleur"} de ce thème depuis l&apos;éditeur visuel :{" "}
                  {SITE_ROLES.filter((r) => sitePalette[r.key]).map((r) => r.name.toLowerCase()).join(", ")}. Elles s&apos;appliquent par-dessus ce thème tant qu&apos;il est en ligne ; les couleurs ci-dessous restent celles du thème. Pour les retirer : éditeur visuel, panneau « Couleurs » du site, « Revenir aux couleurs du thème ».
                </p>
              </div>
            )}
            <PaletteEditor colors={colors} palette={theme.tokens.palette} onChange={setPalette} errors={errors} />
          </section>

          <section className="a-panel" aria-labelledby="t-typo">
            <h2 id="t-typo">Typographies</h2>
            {(
              [
                ["display", "Titres", "Ton nom, les titres de section."],
                ["body", "Texte", "Paragraphes et menus."],
                ["caption", "Légendes", "Étiquettes et légendes des œuvres."],
              ] as const
            ).map(([role, label, help]) => (
              <fieldset key={role} className="a-fieldset">
                <legend>{label}</legend>
                <p className="a-help">{help}</p>
                <div className="a-font-grid">
                  {FONT_IDS.map((fid: FontId) => (
                    <label key={fid} className="a-font-choice">
                      <input type="radio" name={`font-${role}`} checked={theme.tokens.font[role] === fid} onChange={() => setTokens("font", { [role]: fid })} />
                      <span className="a-font-sample" style={{ fontFamily: FONT_STACKS[fid].stack, fontWeight: role === "display" ? FONT_STACKS[fid].headingWeight : 400 }}>
                        Aa Planches &amp; décors
                      </span>
                      <span className="a-font-name">{FONT_STACKS[fid].label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <ThemeTypeEditor
              value={theme.tokens.type}
              onChange={(next) =>
                setTheme((t) => {
                  const tokens = { ...t.tokens };
                  if (next) tokens.type = next;
                  else delete tokens.type;
                  return { ...t, tokens };
                })
              }
            />
          </section>

          <section className="a-panel" aria-labelledby="t-formes">
            <h2 id="t-formes">Formes</h2>
            {(Object.keys(VARIANT_LABELS) as (keyof Theme["variants"])[]).map((key) => {
              const meta = VARIANT_LABELS[key];
              return (
                <fieldset key={key} className="a-fieldset">
                  <legend>{meta.title}</legend>
                  <p className="a-help">{meta.help}</p>
                  <div className="a-variant-grid">
                    {Object.entries(meta.options).map(([opt, label]) => (
                      <label key={opt} className="a-variant-choice">
                        <input
                          type="radio"
                          name={`variant-${key}`}
                          checked={theme.variants[key] === opt}
                          onChange={() => setTheme((t) => ({ ...t, variants: { ...t.variants, [key]: opt } }))}
                        />
                        {VARIANT_THUMBS[key][opt]}
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {theme.variants.hero === "parallax-layers" && !theme.assets.heroLayers?.length && (
              <p className="a-help">Ce thème n&apos;a pas de calques : l&apos;ouverture « Calques en relief » s&apos;affiche sans relief.</p>
            )}
            <h3 className="a-subhead">Arrondis</h3>
            {(
              [
                ["sm", "Petits éléments", 0, 16],
                ["md", "Cartes", 0, 32],
                ["lg", "Grands blocs", 0, 40],
                ["strip", "Images des planches", 0, 16],
              ] as const
            ).map(([k, label, min, max]) => (
              <Slider key={k} label={label} min={min} max={max} step={1} unit="px" value={px(theme.tokens.radius[k])} onChange={(v) => setTokens("radius", { [k]: `${v}px` })} />
            ))}
            <h3 className="a-subhead">Espacements</h3>
            <Slider
              label="Entre les sections"
              help="Sur grand écran ; réduit de moitié sur mobile."
              min={5}
              max={12}
              step={0.5}
              unit="rem"
              value={clampMax(theme.tokens.space.sectionGap)}
              onChange={(v) => setTokens("space", { sectionGap: `clamp(${v / 2}rem, 10vw, ${v}rem)` })}
            />
            <Slider
              label="Marges latérales"
              min={2}
              max={5}
              step={0.25}
              unit="rem"
              value={clampMax(theme.tokens.space.gutter)}
              onChange={(v) => setTokens("space", { gutter: `clamp(1.25rem, 5vw, ${v}rem)` })}
            />
            <Slider
              label="Largeur maximale du contenu"
              min={960}
              max={1600}
              step={20}
              unit="px"
              value={px(theme.tokens.space.pageMax)}
              onChange={(v) => setTokens("space", { pageMax: `${v}px` })}
            />
          </section>

          <PaperSettings theme={theme} onChange={(kit) => setTheme((t) => ({ ...t, assets: { ...t.assets, kit } }))} />
          <CursorSettings theme={theme} onChange={(kit) => setTheme((t) => ({ ...t, assets: { ...t.assets, kit } }))} />

          <SaveBar
            dirty={dirty}
            saving={saving}
            onSave={save}
            error={error}
            note={isActive ? "Ce thème est en ligne : l'enregistrer le publie aussitôt." : undefined}
          />
          <div className="a-kit-export">
            <KitDownloadButton themeId={initial.id} />
            <Link className="a-btn a-btn-quiet" href={`/admin/themes/${encodeURIComponent(initial.id)}/kit`}>
              Renvoyer le kit rempli…
            </Link>
            <p className="a-help">
              Un fichier Photoshop pré-rempli avec ce thème (état enregistré{dirty ? " : enregistre d'abord tes changements" : ""}) : peins les
              calques qui t&apos;intéressent, laisse les autres en aplat.
            </p>
          </div>
          <p className="a-help">
            <Link href="/admin/themes">← Tous les thèmes</Link>
          </p>
        </div>

        <div className="a-theme-preview" id={`${tabsId}-ap`} role="tabpanel" aria-labelledby={`${tabsId}-a`}>
          <Preview theme={theme} themeId={initial.id} reloadKey={reloadKey} />
        </div>
      </div>
    </div>
  );
}
