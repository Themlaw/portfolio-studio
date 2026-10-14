"use client";

/**
 * Éditeur de thème : réglages à gauche, aperçu en direct à droite (cadre de
 * l'accueil en draft mode, mis à jour par postMessage sans rechargement ; il
 * est rechargé après chaque enregistrement pour les formes rendues côté
 * serveur). Sous 1100px, l'aperçu passe dans un onglet.
 *
 * Lot 19b : section « Couleurs de la DA » (panneau « Couleurs » de l'éditeur visuel, en mode thème) à côté de l'aperçu
 * vivant : survol d'un rôle = surlignage des éléments dans l'aperçu (même code que la toile), clic = sélecteur de
 * couleur, contraste en direct. Un thème livré (`preset`) ne s'enregistre pas : à la première modification, on propose
 * une copie modifiable et l'édition continue dessus. Le thème en ligne demande une confirmation avant de publier.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { duplicateThemeAction, saveThemeAction } from "@/app/admin/(espace)/themes/actions";
import { ColorsPanel } from "./editor/SiteLookPanel";
import { contrastReport } from "@/themes/contrast";
import { themeTypeCss } from "@/lib/look";
import { themeAttributes, themeToCss } from "@/themes/css";
import { FONT_STACKS } from "@/themes/font-stacks";
import { contrastRatio, normalizePalette, resolvePalette } from "@/themes/palette";
import { FONT_IDS, type FontId, type Theme } from "@/themes/schema";

import { clone, ConfirmDialog, SaveBar, same, toast, useUnsavedGuard } from "./editing";
import CardSettings from "./CardSettings";
import CursorSettings from "./CursorSettings";
import PaperSettings from "./PaperSettings";
import KitDownloadButton from "./KitDownloadButton";
import PaletteEditor from "./PaletteEditor";
import type { SitePalette } from "@/lib/look";
import { applySitePalette, SITE_ROLES } from "@/themes/site-palette";
import type { BaseKey } from "@/themes/palette";
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

export type PreviewPage = { id: number; title: string };
export type HighlightLegend = { role: BaseKey | null; count: number; uses: string[] };

function Preview({
  theme,
  themeId,
  reloadKey,
  highlight,
  onLegend,
  pages,
  pushRef,
}: {
  theme: Theme;
  themeId: string;
  reloadKey: number;
  /** Envoi immédiat d'un thème au cadre, depuis un gestionnaire d'évènement (avant le rendu React : l'aperçu suit la saisie). */
  pushRef: { current: ((t: Theme) => void) | null };
  /** Rôle de couleur à surligner dans le cadre (null : rien). */
  highlight: BaseKey | null;
  onLegend: (legend: HighlightLegend) => void;
  pages: PreviewPage[];
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Page montrée : l'accueil, ou une page au choix (avec CE thème en essai, pas celui en ligne).
  const [pageId, setPageId] = useState(0);
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
  }, [reloadKey, pageId]);

  const post = useCallback((t: Theme) => {
    frame.current?.contentWindow?.postMessage(
      { type: "portfolio:theme", css: [themeToCss(t), themeTypeCss(t)].filter(Boolean).join("\n"), attrs: themeAttributes(t) },
      window.location.origin,
    );
  }, []);
  const send = useCallback(() => post(theme), [post, theme]);
  useEffect(() => {
    pushRef.current = post;
    return () => {
      pushRef.current = null;
    };
  }, [post, pushRef]);

  // Surlignage d'un rôle (même code que la toile de l'éditeur visuel, côté cadre : PreviewBridge).
  const sendHighlight = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "portfolio:highlight", role: highlight }, window.location.origin);
  }, [highlight]);
  useEffect(() => {
    sendHighlight();
  }, [sendHighlight]);

  useEffect(() => {
    const t = setTimeout(send, 60);
    return () => clearTimeout(t);
  }, [send]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "portfolio:ready") {
        send();
        sendHighlight();
      } else if (e.data?.type === "portfolio:highlight-info" && Array.isArray(e.data.uses)) {
        onLegend({ role: e.data.role, count: Number(e.data.count) || 0, uses: e.data.uses.filter((u: unknown) => typeof u === "string").slice(0, 8) });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send, sendHighlight, onLegend]);

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
        <label className="a-preview-page">
          <span className="muted">Aperçu, visible par toi seul :</span>
          <select aria-label="Page montrée dans l'aperçu" value={pageId} onChange={(e) => setPageId(Number(e.target.value))}>
            <option value={0}>Accueil</option>
            {pages.map((pg) => (
              <option key={pg.id} value={pg.id}>
                {pg.title}
              </option>
            ))}
          </select>
        </label>
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
        {pageId > 0 && <input type="hidden" name="page" value={pageId} />}
        <input type="hidden" name="retour" value="/admin/themes" />
      </form>
      <div ref={box} className="a-preview-box">
        <iframe
          ref={frame}
          name={frameName}
          title="Aperçu du thème"
          className="a-preview-frame"
          style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}

/* ---- Éditeur ------------------------------------------------------------ */

/** Couleurs tenues d'un thème livré vers sa copie (sessionStorage : l'édition continue sur la copie, sans rien enregistrer). */
const carryKey = (copyId: string) => `portfolio:couleurs-copie:${copyId}`;

export default function ThemeEditor({
  initial,
  isActive,
  sitePalette = {},
  pages = [],
  editorHref,
}: {
  initial: Theme;
  isActive: boolean;
  sitePalette?: SitePalette;
  pages?: PreviewPage[];
  /** Éditeur de page (surcharge des couleurs du site) : cible du lien de l'avertissement. */
  editorHref?: string;
}) {
  const router = useRouter();
  const preset = initial.preset;
  const [hl, setHl] = useState<BaseKey | null>(null);
  const [legend, setLegend] = useState<HighlightLegend | null>(null);
  const [copying, startCopying] = useTransition();
  const [confirmLive, setConfirmLive] = useState(false);
  const pushRef = useRef<((t: Theme) => void) | null>(null);
  const [saved, setSaved] = useState(initial);
  const [theme, setTheme] = useState(() => clone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [tab, setTab] = useState<"reglages" | "apercu">("reglages");
  const [reloadKey, setReloadKey] = useState(0);
  const dirty = !same(theme, saved);
  // Un thème livré ne s'enregistre pas : ses essais de couleurs ne retiennent pas la page.
  useUnsavedGuard(dirty && !preset);

  // Copie créée depuis un thème livré : les couleurs choisies sont reprises, non enregistrées.
  useEffect(() => {
    if (preset) return;
    try {
      const raw = sessionStorage.getItem(carryKey(initial.id));
      if (!raw) return;
      sessionStorage.removeItem(carryKey(initial.id));
      const carried = JSON.parse(raw) as { color?: Theme["tokens"]["color"]; palette?: Theme["tokens"]["palette"] };
      if (!carried.color) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reprise unique, après le montage : le stockage n'existe pas côté serveur.
      setTheme((t) => {
        const tokens = { ...t.tokens, color: carried.color! };
        if (carried.palette) tokens.palette = carried.palette;
        else delete tokens.palette;
        return { ...t, tokens };
      });
    } catch {
      /* stockage indisponible : la copie s'ouvre telle quelle */
    }
  }, [initial.id, preset]);

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

  /** Un correctif du panneau « Couleurs de la DA » ({ rôle: couleur }) posé sur les couleurs courantes (nuances dépendantes recalculées). */
  const patchBases = (patch: SitePalette) => {
    const next = applySitePalette(theme.tokens.color, theme.tokens.palette, patch);
    const tokens = { ...theme.tokens, color: next.color };
    if (next.palette) tokens.palette = next.palette;
    else delete tokens.palette;
    const updated = { ...theme, tokens };
    // L'aperçu d'abord (même évènement, sans attendre le rendu de tout l'éditeur), puis l'état du formulaire.
    pushRef.current?.(updated);
    setTheme(updated);
  };
  const colorsChanged = !same(theme.tokens.color, saved.tokens.color) || !same(theme.tokens.palette ?? null, saved.tokens.palette ?? null);

  // Thème livré : on garde un brouillon de couleurs en mémoire, la copie est proposée tout de suite.
  const makeCopy = () =>
    startCopying(async () => {
      const result = await duplicateThemeAction(initial.id);
      if (!result.ok) return toast(result.message, "error");
      try {
        sessionStorage.setItem(carryKey(result.data.id), JSON.stringify({ color: theme.tokens.color, palette: theme.tokens.palette }));
      } catch {
        /* sans stockage, la copie s'ouvre avec les couleurs du thème livré */
      }
      toast(`Copie « ${initial.name} (copie) » créée : tes couleurs y sont reprises`);
      router.push(`/admin/themes/${result.data.id}`);
    });

  // Même contrôle que le serveur (nuances auto recalculées), plus le texte posé sur le voile.
  const contrastFailures = useMemo(() => {
    const normalized = normalizePalette(colors, theme.tokens.palette);
    const p = resolvePalette(colors, theme.tokens.palette);
    return contrastReport(normalized).some((x) => !x.ok) || contrastRatio(p.onScrim, p.scrim) < 4.5;
  }, [colors, theme.tokens.palette]);

  /** Enregistrer : le thème en ligne demande d'abord une confirmation quand ses couleurs changent. */
  const save = () => {
    if (contrastFailures) {
      setError("Contraste insuffisant : corrige les couleurs signalées (bouton « Ajuster ») avant d'enregistrer.");
      return;
    }
    if (isActive && colorsChanged) {
      setConfirmLive(true);
      return;
    }
    persist();
  };
  const persist = () => {
    setConfirmLive(false);
    startSaving(async () => {
      const result = await saveThemeAction(initial.id, theme, isActive);
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
          <section className="a-panel a-da" id="couleurs-da" aria-labelledby="t-da" data-testid="da-section">
            <h2 id="t-da">Couleurs de la DA</h2>
            {Object.keys(sitePalette).length > 0 && (
              <div className="a-notice" role="note" data-testid="da-site-override">
                <p>
                  Le site remplace {Object.keys(sitePalette).length} de ces couleurs depuis l&apos;éditeur de page :{" "}
                  {SITE_ROLES.filter((r) => sitePalette[r.key]).map((r) => r.name.toLowerCase()).join(", ")}. Ce que tu changes ici ne s&apos;applique pas à ces couleurs tant que le site les remplace ; les deux réglages restent séparés.{" "}
                  {editorHref ? (
                    <Link href={editorHref} data-testid="da-site-override-link">
                      Ouvrir l&apos;éditeur de page (panneau « Couleurs »)
                    </Link>
                  ) : (
                    "Pour les retirer : éditeur de page, panneau « Couleurs », « Revenir aux couleurs du thème »."
                  )}
                </p>
              </div>
            )}
            {preset && (
              <div className="a-notice" role="note" data-testid="da-preset-note">
                <p>
                  <strong>Thème livré avec le site : il ne se modifie pas.</strong> Essaie des couleurs ici, elles se voient dans l&apos;aperçu ; pour les garder, crée une copie modifiable.
                </p>
              </div>
            )}
            {preset && colorsChanged && (
              <div className="a-notice a-da-copy" role="alert" data-testid="da-copy-prompt">
                <p>Tes couleurs ne sont pas enregistrées : un thème livré est en lecture seule.</p>
                <p className="a-da-copy-actions">
                  <button type="button" className="a-btn a-btn-primary" onClick={makeCopy} disabled={copying} data-testid="da-copy">
                    {copying ? "Création de la copie…" : "Créer une copie modifiable de ce thème"}
                  </button>
                  <button type="button" className="a-btn a-btn-quiet" onClick={() => setTheme(clone(saved))}>
                    Abandonner mes essais
                  </button>
                </p>
                <p className="a-help">La copie est un brouillon nommé « {initial.name} (copie) », hors ligne ; tes couleurs y sont reprises et tu continues l&apos;édition dessus.</p>
              </div>
            )}
            <ColorsPanel
              mode="theme"
              theme={{ name: theme.name, color: colors, palette: theme.tokens.palette ?? null }}
              baseline={saved.tokens.color}
              value={{}}
              onChange={patchBases}
              onHighlight={setHl}
              info={legend}
              locked={null}
            />
            {!preset && (
              <div className="a-da-save">
                <p className="a-help" data-testid="da-state">
                  {colorsChanged
                    ? isActive
                      ? "Couleurs modifiées : tes visiteurs ne les verront qu'après « Enregistrer »."
                      : "Couleurs modifiées, pas encore enregistrées."
                    : "Les couleurs montrées sont celles du thème enregistré."}
                </p>
                <button type="button" className="a-btn a-btn-primary" onClick={save} disabled={saving || !dirty} data-testid="da-save">
                  {saving ? "Enregistrement…" : isActive ? "Enregistrer et publier…" : "Enregistrer les couleurs"}
                </button>
              </div>
            )}
          </section>

          {preset ? null : (
          <>
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

          <CardSettings
            theme={theme}
            sitePalette={sitePalette}
            onChange={(card) =>
              setTheme((t) => {
                const layout = { ...t.tokens.layout };
                if (card) layout.card = card;
                else delete layout.card;
                const tokens = { ...t.tokens };
                if (Object.keys(layout).length) tokens.layout = layout;
                else delete tokens.layout;
                return { ...t, tokens };
              })
            }
          />
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
          </>
          )}
          <p className="a-help">
            <Link href="/admin/themes">← Tous les thèmes</Link>
          </p>
        </div>

        <div className="a-theme-preview" id={`${tabsId}-ap`} role="tabpanel" aria-labelledby={`${tabsId}-a`}>
          <Preview theme={theme} themeId={initial.id} reloadKey={reloadKey} highlight={hl} onLegend={setLegend} pages={pages} pushRef={pushRef} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmLive}
        title={`Publier les couleurs de « ${theme.name} » ?`}
        confirmLabel="Enregistrer et publier"
        busy={saving}
        onClose={() => setConfirmLive(false)}
        onConfirm={persist}
      >
        <p>
          <strong>Ce thème est en ligne : tes visiteurs verront ces couleurs</strong> dès l&apos;enregistrement, sur toutes les pages.
        </p>
        <ul className="a-da-changes">
          {SITE_ROLES.filter((r) => String(theme.tokens.color[r.key]).toLowerCase() !== String(saved.tokens.color[r.key]).toLowerCase()).map((r) => (
            <li key={r.key}>
              {r.name} : <span className="a-chip" style={{ background: saved.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{saved.tokens.color[r.key]}</span> →{" "}
              <span className="a-chip" style={{ background: theme.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{theme.tokens.color[r.key]}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
