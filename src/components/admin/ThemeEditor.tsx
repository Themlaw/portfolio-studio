"use client";

/**
 * Éditeur de thème guidé (lot 61) : un en-tête collant (nom, état, UN seul bouton « Enregistrer »), cinq étapes dans la colonne de
 * gauche, UNE ouverte à la fois (Couleurs, Textes, Cartes et cadres, Papier et motifs, Logo), l'aperçu en direct à droite (cadre de
 * l'accueil en draft mode, mis à jour par postMessage sans rechargement ; rechargé après chaque enregistrement pour les formes rendues
 * côté serveur). Sous 1100px, l'aperçu passe dans un onglet. « Précédent / Suivant » en bas de chaque étape, « Publier » à la dernière.
 *
 * Réglages avancés : chaque étape a son « Affiner (avancé) » replié, avec le compteur de réglages modifiés. Les réglages simplifiés
 * (Arrondi, Espacements) ne remplacent jamais les valeurs précises d'un thème tant qu'on n'y touche pas (src/themes/guided.ts).
 *
 * Couleurs (lots 19b, 29, 61) : les quatre couleurs de base (panneau « Couleurs » de l'éditeur visuel, en mode thème, survol = surlignage
 * dans l'aperçu), la lisibilité en une ligne, puis « Affiner » pour les autres couleurs (un seul bloc : plus de second éditeur de palette).
 * Un thème livré (`preset`) ne s'enregistre pas : à la première modification, on propose une copie modifiable et l'édition continue
 * dessus. Le thème en ligne demande une confirmation avant de publier.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";

import { activateThemeAction, closeEditSessionAction, duplicateThemeAction, saveThemeAction } from "@/app/admin/(espace)/themes/actions";
import { ColorsPanel, GUIDED_ROLES } from "./editor/SiteLookPanel";
import { pairsReadability, ratioTip } from "@/components/edit/readability";
import { themeTypeCss } from "@/lib/look";
import { customNuances, roundLevelOf, ROUND_LEVELS, spaceLevelOf, SPACE_LEVELS } from "@/themes/guided";
import { themeAttributes, themeToCss } from "@/themes/css";
import { FONT_STACKS } from "@/themes/font-stacks";
import type { FontId, KitAssets, Theme } from "@/themes/schema";

import { clone, ConfirmDialog, SaveBar, same, toast, useUnsavedGuard } from "./editing";
import { Advanced } from "./guide/controls";
import LogoStep from "./guide/LogoStep";
import PaperStep, { type PaperTab } from "./guide/PaperStep";
import ShapesStep from "./guide/ShapesStep";
import TextStep from "./guide/TextStep";
import KitDownloadButton from "./KitDownloadButton";
import PaletteEditor from "./PaletteEditor";
import type { SitePalette } from "@/lib/look";
import { applySitePalette, SITE_NUANCES, SITE_ROLES, sitePalettePairs } from "@/themes/site-palette";
import type { NuanceKey } from "@/themes/palette";
import type { BaseKey } from "@/themes/palette";
import { resolvePalette } from "@/themes/palette";

import "@/app/admin/theme-guide.css";

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

export const STEPS = [
  { id: "couleurs", title: "Couleurs" },
  { id: "textes", title: "Textes" },
  { id: "cartes", title: "Cartes et cadres" },
  { id: "papier", title: "Papier et motifs" },
  { id: "logo", title: "Logo" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];
const stepOf = (v: unknown): StepId => STEPS.find((s) => s.id === v)?.id ?? "couleurs";

/** Lisibilité en une ligne (« Lisible » / « Difficile à lire sur le fond »), le détail dépliable. Jamais bloquant. */
function Readability({ colors, palette }: { colors: Theme["tokens"]["color"]; palette: Theme["tokens"]["palette"] }) {
  const pairs = sitePalettePairs(colors, palette, undefined);
  const bad = pairs.filter((p) => !p.ok);
  return (
    <div className="a-read" data-ok={bad.length === 0} data-testid="readability">
      <p className="a-read-line" role="status">
        {bad.length === 0 ? (
          <>
            <span aria-hidden="true">✓</span> <strong>Lisible</strong> : tes textes se lisent bien sur leurs fonds.
          </>
        ) : (
          <>
            <span aria-hidden="true">⚠</span> <strong>Difficile à lire sur le fond</strong> : {bad.slice(0, 3).map((p) => p.label.toLowerCase()).join(", ")}
            {bad.length > 3 ? "…" : ""}. Le site s&apos;affiche quand même ; ajuste ces couleurs pour plus de confort.
          </>
        )}
      </p>
      <details className="a-read-detail">
        <summary>Voir le détail</summary>
        <ul>
          {pairs.map((p) => (
            <li key={p.label} data-ok={p.ok} title={ratioTip(p.ratio)}>
              {p.ok ? "✓" : "✗"} {p.label} : {pairsReadability([p]).label}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export default function ThemeEditor({
  initial,
  isActive,
  sitePalette = {},
  pages = [],
  editorHref,
  activeName,
  initialStep,
  initialTab,
  wallpapers,
  favicon,
  mine = null,
}: {
  initial: Theme;
  isActive: boolean;
  sitePalette?: SitePalette;
  pages?: PreviewPage[];
  /** Éditeur de page (surcharge des couleurs du site) : cible du lien de l'avertissement. */
  editorHref?: string;
  /** Nom du thème actuellement en ligne (fenêtre « Publier » d'un thème hors ligne). */
  activeName?: string;
  /** Étape ouverte à l'arrivée (`?etape=`), et onglet de l'étape « Papier et motifs » (`?onglet=papiers-peints`). */
  initialStep?: string;
  initialTab?: string;
  /** Bibliothèque des papiers peints (page « Papiers peints » d'avant, rendue par le serveur : onglet de l'étape 4). */
  wallpapers?: ReactNode;
  /** Icône de l'onglet (lot 83), rendue par le serveur : le même composant que dans Réglages → Référencement (un seul réglage de site). */
  favicon?: ReactNode;
  /**
   * Mon thème (lot 60) : « Enregistrer » crée ou met à jour la version en cours (un brouillon), jamais le site public ; « Publier cette version »
   * (en-tête et dernière étape) met la version en ligne. `isActive` vaut alors false (aucune confirmation « en ligne » à l'enregistrement).
   */
  mine?: { version: number; publishedVersion: number | null; live: boolean; published: Theme | null } | null;
}) {
  const router = useRouter();
  const preset = initial.preset;
  const [step, setStep] = useState<StepId>(() => stepOf(initialStep));
  const [paperTab, setPaperTab] = useState<PaperTab>(initialTab === "papiers-peints" ? "papiers-peints" : "fond");
  const [hl, setHl] = useState<BaseKey | null>(null);
  const [legend, setLegend] = useState<HighlightLegend | null>(null);
  const [copying, startCopying] = useTransition();
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const pushRef = useRef<((t: Theme) => void) | null>(null);
  const [saved, setSaved] = useState(initial);
  const [theme, setTheme] = useState(() => clone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [version, setVersion] = useState(mine?.version ?? 0);
  const isMine = Boolean(mine);
  const differs = Boolean(mine && mine.publishedVersion != null && mine.publishedVersion !== version);
  const needsPublish = Boolean(mine && (!mine.live || differs));
  const [tab, setTab] = useState<"reglages" | "apercu">("reglages");
  const [reloadKey, setReloadKey] = useState(0);
  const dirty = !same(theme, saved);
  // Un thème livré ne s'enregistre pas : ses essais de couleurs ne retiennent pas la page.
  useUnsavedGuard(dirty && !preset);

  // Mon thème : à la sortie de l'éditeur, la séance d'édition est close (le prochain enregistrement crée une nouvelle version).
  useEffect(() => {
    if (!isMine) return;
    const id = initial.id;
    return () => {
      void closeEditSessionAction(id);
    };
  }, [isMine, initial.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- le numéro de version suit celui du serveur après un rafraîchissement.
    if (mine) setVersion(mine.version);
  }, [mine]);

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
  const setKit = (kit: KitAssets) =>
    setTheme((t) => {
      const assets = { ...t.assets };
      if (Object.keys(kit).length) assets.kit = kit;
      else delete assets.kit;
      return { ...t, assets };
    });

  /** Un correctif du panneau « Couleurs » ({ rôle: couleur }) posé sur les couleurs courantes (nuances dépendantes recalculées). */
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
  /** Noms (en minuscules) des couleurs que le site remplace : rôles, puis nuances. */
  const overrideNames = (sp: SitePalette) =>
    [...SITE_ROLES.filter((r) => sp[r.key]).map((r) => r.name), ...(Object.keys(SITE_NUANCES) as NuanceKey[]).filter((k) => sp[k]).map((k) => SITE_NUANCES[k].name)]
      .map((n) => n.toLowerCase())
      .join(", ");
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

  /** Enregistrer : le thème en ligne demande d'abord une confirmation quand ses couleurs changent. */
  const save = () => {
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
      if (isMine) {
        const v = (result.data as { version?: number } | null)?.version;
        if (v) setVersion(v);
        toast(`Enregistré · version ${v ?? version} (brouillon, pas encore en ligne)`);
      } else toast(isActive ? "Enregistré · en ligne pour tes visiteurs" : "Enregistré");
      // Hors de la transition : l'état « Enregistré » s'affiche sans attendre le rafraîchissement.
      setTimeout(() => router.refresh(), 0);
    });
  };

  /** « Publier » (dernière étape) : un thème en ligne s'enregistre (= publie) ; un thème hors ligne est enregistré puis mis en ligne. */
  const publish = () => {
    if (preset) return;
    if (isMine && !needsPublish && !dirty) return;
    if (isActive) {
      if (dirty) save();
      return;
    }
    setConfirmPublish(true);
  };
  const publishNow = () => {
    setConfirmPublish(false);
    startSaving(async () => {
      if (dirty) {
        const result = await saveThemeAction(initial.id, theme, false);
        if (!result.ok) {
          setError(result.message);
          setErrors(result.fieldErrors ?? {});
          return;
        }
        const v = isMine ? (result.data as { version?: number } | null)?.version : undefined;
        if (v) setVersion(v);
        setSaved(clone(theme));
        setReloadKey((k) => k + 1);
      }
      const live = await activateThemeAction(initial.id);
      if (!live.ok) {
        setError(live.message);
        return;
      }
      setError(null);
      setErrors({});
      toast(isMine ? `Version ${version} publiée : elle est en ligne pour tes visiteurs` : `« ${theme.name} » est en ligne : tes visiteurs le voient.`);
      setTimeout(() => router.refresh(), 0);
    });
  };

  const go = (id: StepId) => {
    setStep(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("etape", id);
      if (id !== "papier") url.searchParams.delete("onglet");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* adresse non modifiable : l'étape reste choisie à l'écran */
    }
    // Le haut de l'étape ouverte reste en vue sous l'en-tête collant.
    requestAnimationFrame(() => document.getElementById(`etape-${id}`)?.scrollIntoView({ block: "start", behavior: "auto" }));
  };
  const changePaperTab = (t: PaperTab) => {
    setPaperTab(t);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("etape", "papier");
      if (t === "papiers-peints") url.searchParams.set("onglet", t);
      else url.searchParams.delete("onglet");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* adresse non modifiable */
    }
  };

  const tabsId = useId();
  const nuanceCount = customNuances(colors, theme.tokens.palette).length;
  const round = roundLevelOf(theme.tokens.radius, theme.variants.button);
  const space = spaceLevelOf(theme.tokens.space);
  const resolved = resolvePalette(colors, theme.tokens.palette);
  const logo = theme.assets.kit?.signature;

  /** Une ligne de résumé sous le titre de chaque étape : ce qui est choisi, d'un coup d'œil. */
  const summaries: Record<StepId, ReactNode> = {
    couleurs: (
      <span className="a-step-chips" aria-hidden="true">
        {GUIDED_ROLES.map((k) => (
          <span key={k} className="a-step-chip" style={{ background: resolved[k] }} />
        ))}
      </span>
    ),
    textes: `${FONT_STACKS[theme.tokens.font.display as FontId].label} · ${FONT_STACKS[theme.tokens.font.body as FontId].label}`,
    cartes: `Arrondi : ${ROUND_LEVELS[round.index].label}${round.exact ? "" : " (précis)"}`,
    papier: `${theme.variants.texture === "none" ? "Fond uni" : "Papier pointillé"} · Espacement : ${SPACE_LEVELS[space.index].label}${space.exact ? "" : " (précis)"}`,
    logo: logo ? (logo.colors === true ? "Logo en couleurs" : "Logo à la couleur du texte") : "Nom écrit en texte",
  };

  /** Étapes 2 à 5 d'un thème livré : lecture seule, une copie modifiable est proposée. */
  const locked = preset ? (
    <div className="a-notice" role="note" data-testid="step-locked">
      <p>
        <strong>Thème livré avec le site : il ne se modifie pas.</strong> Pour régler cette étape, crée d&apos;abord une copie modifiable.
      </p>
      <p>
        <button type="button" className="a-btn a-btn-primary" onClick={makeCopy} disabled={copying} data-testid="step-locked-copy">
          {copying ? "Création de la copie…" : "Créer une copie modifiable de ce thème"}
        </button>
      </p>
    </div>
  ) : null;

  const stepContent: Record<StepId, ReactNode> = {
    couleurs: (
      <>
        {Object.keys(sitePalette).length > 0 && (
          <div className="a-notice" role="note" data-testid="da-site-override">
            <p>
              <strong>Couleurs personnalisées du site</strong> : {Object.keys(sitePalette).length} de ces couleurs sont remplacées depuis l&apos;éditeur de page :{" "}
              {overrideNames(sitePalette)}. Ce que tu changes ici ne s&apos;applique pas à ces couleurs tant qu&apos;elles sont personnalisées ; les deux réglages restent séparés.{" "}
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
        <p className="a-help a-step-intro">Commence par 4 couleurs. Le reste se calcule tout seul.</p>
        <ColorsPanel
          mode="theme"
          guided
          theme={{ name: theme.name, color: colors, palette: theme.tokens.palette ?? null }}
          baseline={saved.tokens.color}
          value={{}}
          onChange={patchBases}
          onHighlight={setHl}
          info={legend}
          locked={null}
        />
        <Readability colors={colors} palette={theme.tokens.palette} />
        {!preset && (
          <>
            <Advanced
              id="couleurs"
              count={nuanceCount}
              hint="Les autres couleurs (fond des blocs, traits fins, survol, ombres…) se calculent à partir des quatre couleurs de base. Change-en une pour la fixer ; « Revenir à auto » la rend au calcul."
            >
              {Object.keys(sitePalette).length > 0 && (
                <div className="a-notice" role="note" data-testid="site-palette-notice">
                  <p>
                    Le site remplace {Object.keys(sitePalette).length > 1 ? "des couleurs" : "une couleur"} de ce thème depuis l&apos;éditeur visuel : {overrideNames(sitePalette)}. Elles s&apos;appliquent par-dessus ce thème tant
                    qu&apos;il est en ligne ; les couleurs ci-dessous restent celles du thème. Pour les retirer : éditeur visuel, panneau « Couleurs » du site, « Revenir aux couleurs du thème ».
                  </p>
                </div>
              )}
              <PaletteEditor colors={colors} palette={theme.tokens.palette} onChange={setPalette} errors={errors} hideBases={[...GUIDED_ROLES]} sample={false} intro={null} />
            </Advanced>
            <p className="a-help" data-testid="da-state">
              {colorsChanged
                ? isActive
                  ? "Couleurs modifiées : tes visiteurs ne les verront qu'après « Enregistrer »."
                  : "Couleurs modifiées, pas encore enregistrées."
                : "Les couleurs montrées sont celles du thème enregistré."}
            </p>
          </>
        )}
      </>
    ),
    textes: preset ? locked : <TextStep theme={theme} onAir={(air) => setTokens("layout", { textAir: air })} onFont={(role, font) => setTokens("font", { [role]: font })} onType={(next) => setTheme((t) => {
      const tokens = { ...t.tokens };
      if (next) tokens.type = next;
      else delete tokens.type;
      return { ...t, tokens };
    })} />,
    cartes: preset ? locked : <ShapesStep theme={theme} sitePalette={sitePalette} setTheme={setTheme} setTokens={setTokens} />,
    papier: <PaperStep theme={theme} locked={locked} setTheme={setTheme} setTokens={setTokens} tab={paperTab} onTab={changePaperTab} wallpapers={wallpapers} />,
    logo: <LogoStep theme={theme} themeId={initial.id} onKit={setKit} locked={locked} favicon={favicon} />,
  };

  const status = preset
    ? "Thème livré · lecture seule"
    : mine
      ? mine.live
        ? differs
          ? `En ligne : v${mine.publishedVersion} · brouillon : v${version}`
          : `En ligne : v${mine.publishedVersion}`
        : mine.publishedVersion != null
          ? `Pas en ligne · dernière publiée : v${mine.publishedVersion} · brouillon : v${version}`
          : "Brouillon · pas encore en ligne"
      : isActive
        ? "En ligne"
        : "Brouillon · pas en ligne";
  const live = isActive || Boolean(mine?.live);

  return (
    <div className="a-theme-editor a-guide" data-tab={tab} data-step={step}>
      <header className="a-guide-head" data-testid="guide-head">
        <div className="a-guide-title">
          {preset ? (
            <h1 className="a-guide-name">{theme.name}</h1>
          ) : (
            <div className={`a-guide-namefield${errors.name ? " a-field-invalid" : ""}`}>
              <input id="theme-name" className="a-input a-guide-name" aria-label="Nom du thème" value={theme.name} maxLength={60} onChange={(e) => setTheme((t) => ({ ...t, name: e.target.value }))} />
              {errors.name && <p className="a-field-error">{errors.name}</p>}
            </div>
          )}
          <span className="a-guide-status" data-state={preset ? "preset" : live ? "live" : "draft"} data-testid="guide-status">
            {status}
          </span>
          {mine && (
            <span className="a-guide-version" data-testid="guide-version">
              Version {version}
            </span>
          )}
        </div>
        <div className="a-guide-actions">
          <details className="a-kit-menu" data-testid="kit-menu">
            <summary className="a-btn a-btn-quiet">Dessiner dans Photoshop</summary>
            <div className="a-kit-pop">
              <p className="a-help">
                Un fichier Photoshop pré-rempli avec ce thème (état enregistré{dirty && !preset ? " : enregistre d'abord tes changements" : ""}) : peins les calques qui t&apos;intéressent, laisse les autres en aplat.
              </p>
              <KitDownloadButton themeId={initial.id} />
              <Link className="a-btn a-btn-quiet" href={`/admin/themes/${encodeURIComponent(initial.id)}/kit`}>
                Renvoyer le kit rempli…
              </Link>
            </div>
          </details>
          {!preset && (
            <>
              {dirty && (
                <button type="button" className="a-btn a-btn-quiet" onClick={() => setTheme(clone(saved))} disabled={saving} data-testid="guide-cancel">
                  Annuler
                </button>
              )}
              <SaveBar
                className="a-savebar-head"
                dirty={dirty}
                saving={saving}
                onSave={save}
                error={error}
                testId="da-save"
                note={isMine ? "Enregistrer met à jour la version en cours (un brouillon) : rien n'est publié avant « Publier cette version »." : isActive ? "En ligne : l'enregistrer le publie aussitôt." : undefined}
              />
              {isMine && needsPublish && (
                <button type="button" className="a-btn a-btn-primary" onClick={() => setConfirmPublish(true)} disabled={saving} data-testid="mine-bar-publish">
                  {mine?.live ? "Publier cette version" : "Mettre en ligne cette version"}
                </button>
              )}
              {isMine && (
                <Link className="a-btn a-btn-quiet" href={`/admin/themes/${encodeURIComponent(initial.id)}/versions`} data-testid="guide-history">
                  Historique des versions
                </Link>
              )}
            </>
          )}
        </div>
      </header>

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
          {STEPS.map((s, i) => {
            const open = step === s.id;
            const next = STEPS[i + 1];
            const prev = STEPS[i - 1];
            return (
              <section
                key={s.id}
                id={`etape-${s.id}`}
                className={`a-step${s.id === "couleurs" ? " a-da" : ""}`}
                data-step={s.id}
                data-open={open || undefined}
                aria-labelledby={`t-step-${s.id}`}
                {...(s.id === "couleurs" ? { "data-testid": "da-section" } : {})}
              >
                <h2 id={`t-step-${s.id}`} className="a-step-h">
                  <button type="button" className="a-step-btn" aria-expanded={open} aria-controls={`panel-${s.id}`} onClick={() => go(s.id)} data-testid={`step-tab-${s.id}`}>
                    <span className="a-step-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="a-step-title">{s.title}</span>
                    <span className="a-step-sum">{summaries[s.id]}</span>
                  </button>
                </h2>
                <div id={`panel-${s.id}`} className="a-step-body" hidden={!open}>
                  {stepContent[s.id]}
                  <div className="a-step-nav">
                    {prev ? (
                      <button type="button" className="a-btn" onClick={() => go(prev.id)} data-testid="step-prev">
                        ← Précédent
                      </button>
                    ) : (
                      <span />
                    )}
                    {next ? (
                      <button type="button" className="a-btn a-btn-primary" onClick={() => go(next.id)} data-testid="step-next">
                        Suivant : {next.title} →
                      </button>
                    ) : preset ? null : (
                      <button type="button" className="a-btn a-btn-primary" onClick={publish} disabled={saving || (isMine ? !needsPublish && !dirty : isActive && !dirty)} data-testid="step-publish">
                        {(isMine ? !needsPublish && !dirty : isActive && !dirty) ? "Publié" : isMine ? "Publier cette version" : "Publier"}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
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

      <ConfirmDialog
        open={confirmPublish}
        title={mine ? `Publier la version ${dirty ? version + 1 : version} de « ${theme.name} » ?` : `Mettre « ${theme.name} » en ligne ?`}
        confirmLabel="Publier"
        busy={saving}
        onClose={() => setConfirmPublish(false)}
        onConfirm={publishNow}
      >
        {mine ? (
          <>
            <p className="a-swap" data-testid="activate-swap">
              <span>{mine.live && mine.publishedVersion != null ? `En ligne : v${mine.publishedVersion}` : (activeName ?? "Thème en ligne actuel")}</span>
              <span aria-hidden="true">→</span>
              <strong>
                {theme.name} : v{dirty ? version + 1 : version}
              </strong>
            </p>
            <p className="muted">Tous tes visiteurs verront cette version dès maintenant, sur toutes les pages.{dirty ? " Tes réglages en cours sont enregistrés d'abord (nouvelle version)." : ""}</p>
            {mine.live && mine.published && (
              <ul className="a-da-changes" data-testid="activate-changes">
                {SITE_ROLES.filter((r) => String(theme.tokens.color[r.key]).toLowerCase() !== String(mine.published!.tokens.color[r.key]).toLowerCase()).map((r) => (
                  <li key={r.key}>
                    {r.name} : <span className="a-chip" style={{ background: mine.published!.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{mine.published!.tokens.color[r.key]}</span> →{" "}
                    <span className="a-chip" style={{ background: theme.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{theme.tokens.color[r.key]}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p>
            <strong>Tes visiteurs verront ce thème</strong>
            {activeName ? (
              <>
                {" "}
                à la place de « {activeName} »
              </>
            ) : null}
            , sur toutes les pages, dès maintenant.{dirty ? " Tes réglages en cours sont enregistrés d'abord." : ""}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
