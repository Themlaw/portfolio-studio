"use client";

/**
 * Éditeur visuel d'une page, en plein écran. La toile est le site lui-même,
 * dans une iframe de la même origine en vue brouillon (src/lib/draft-view.ts)
 * avec sa couche d'édition (src/components/EditLayer.tsx) ; l'éditeur tient
 * le brouillon, l'enregistre automatiquement (~800 ms après la dernière
 * modification, aussitôt pour un changement de structure) puis rafraîchit la
 * toile. Rien n'est visible du public avant « Publier ».
 *
 * Panneau gauche (onglets Ajouter, Médias, Structure, Réglages ; feuille du
 * bas sous 820 px), barre du haut (page, langue, largeur, annuler/rétablir,
 * état, Aperçu, Publier).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import {
  addToMenuFromEditorAction,
  boardAction,
  discardSiteDraftAction,
  createDraftProjectAction,
  discardDraftAction,
  installFontAction,
  publishDraftAction,
  restoreBoardAction,
  saveDraftAction,
  siteDraftAction,
} from "@/app/admin/(espace)/pages/actions";
import { PageCollectionField } from "@/app/admin/_fields";
import PageButtonsColorField from "@/app/admin/_fields/PageButtonsColorField";
import PageWallpaperField from "@/app/admin/_fields/PageWallpaperField";
import { BlockEditorContext } from "@/blocks/editor-context";
import { autoEntries, COLLECTION_KEYS, editsFromItems, itemsFromEntries, MAX_TILES, sameL, tilesMode, type TileEdit, type TileItem } from "@/blocks/collection-pages";
import { pickerGroups } from "@/blocks/groups";
import { HELP_TEXT, STARTER_LIST, TEXT_STARTERS, type TextStarter } from "@/blocks/help-text";
import type { BlockCatalogEntry, EditorContext } from "@/blocks/editor-types";
import { blockAtPath, boardRefs, canPlace, descendantCount, errorPath, findBlock, insertBlock, isContainer, listOf, locate, moveBlock, removeBlock, updateBlock, walk as walkTree, withFreshUids } from "@/blocks/tree";
import { applyHeadOp } from "@/blocks/head";
import { fieldOpDef, hasOptionalField, withOptionalField } from "@/blocks/optional-fields";
import { applyGridOp, type GridChild, type GridModelOp } from "@/blocks/grid-layouts";
import { announcePublished } from "@/lib/publish-signal";
import { isFormBlock, makeField, MAX_FIELDS, type FormField } from "@/lib/contact-form";
import { SiteSnapSchema, type SiteSnap } from "@/lib/site-schema";
import type { BoardOp, BoardResult, BoardSnap } from "@/lib/edit/boards";
import type { DraftBlock, PageDraft, PublishResult } from "@/lib/edit/drafts";
import { mediaStatusAction, retryMediaAction } from "@/app/admin/(espace)/medias/actions";
import type { AdminMediaRow } from "@/lib/admin";
import { settleSnap, takeSnap, type LangSnap } from "@/lib/lang-scroll";
import { acceptFromCanvas, EDIT_MSG, inlineAllowed, setLocalizedAt, type BlockInfo, type DropTargetInfo, type FromCanvas, type Ghost, type ToCanvas } from "@/lib/edit/protocol";
import { reportToJournal } from "@/lib/journal/browser";
import { markedProblem } from "@/lib/marked";
import { own } from "@/lib/own";
import { hasFace, type FontLibrary } from "@/lib/fonts/faces";
import type { LookContext } from "@/lib/edit/look-context";
import { convertItem as convertBoardItem } from "@/blocks/grid-strip";
import { BOARD_ITEM_LABELS, parseRailKey, railKey, type BoardBox as BoardBoxProps, type BoardItem, type BoardItemType } from "@/blocks/board-layout";
import { cleanLook, cleanSiteStyles, googleOf, readLook, type HzZone, type Logo, type Look, type Role, type SitePalette, type SiteStyles, type TextStyle } from "@/lib/look";
import { googleFamily, nearestWeight } from "@/themes/google-fonts";
import { readBackground, supportsFond, type Background } from "@/themes/fond";
import { cleanSurface, readSurface, type Surface } from "@/themes/surface";
import { effectiveSitePalette } from "@/themes/site-palette";

import { clone, ConfirmDialog, toast, useUnsavedGuard } from "../editing";
import { filterMedia } from "../LibraryStrip";
import { MediaSortMenu, loadMoreOnFocus, noDate, sortMedia, useMediaSort, useProgressive, useReimportReveal, useTakenDates } from "../media-sort";
import Uploader from "../Uploader";
import { isUploaded, useUploadQueue } from "../UploadQueue";
import { isPdfFile, readRatio, sendFile, useMediaWatch } from "../uploads";
import AddSectionDialog, { type AddChoice } from "./AddSectionDialog";
import { ImageBgControls } from "@/components/edit/ImageBgControls";

import { BlockLookPanel, ImageSizeSection, SiteStylesPanel } from "./LookPanel";
import PreparingBanner from "./PreparingBanner";
import ThemePicker from "./ThemePicker";
import type { ThemeChoice } from "@/lib/edit/theme-usage";
import { ColorsPanel, LogoPanel, type HighlightInfo } from "./SiteLookPanel";
import BoardItemPanel from "./BoardItemPanel";
import { StrokeField } from "./StrokeField";
import MediaPickerDialog from "./MediaPickerDialog";
import { applyFreeLook, applyFreeOp, newFreeId, type FreeModelOp } from "@/blocks/free-board";
import { applyMediaPatch, type MediaPatch } from "@/lib/edit/media-look";
import MediaPreviewDialog from "./MediaPreviewDialog";
import { ZoomButton } from "../MediaLibrary";
import SiteEditor, { applySiteOp, siteText } from "./SiteEditor";
import StructureTree from "./StructureTree";
import { untranslatedLabel } from "@/lib/translation-gaps";
import { describeProblems, type Problem } from "./problems";
import TopMore from "./TopMore";
import BlockThumb from "./thumbs";

/** Journal d'édition (lot 97) : connexion perdue pendant une écriture (le navigateur n'a pas eu de réponse). Renvoie le refus que l'éditeur affiche. */
const LOST = "connexion perdue";
function lostConnection(action: string): { ok: false; message: string } {
  reportToJournal({ kind: "save", reason: "reseau", action, message: LOST });
  return { ok: false, message: LOST };
}
/** Journal d'édition : refus ou conflit vu par l'artiste (la connexion perdue est déjà signalée par lostConnection). */
function reportSaveFailure(action: string, result: { message: string; code?: string }): void {
  if (result.message === LOST) return;
  reportToJournal({ kind: "save", reason: result.code === "conflict" ? "conflit" : "refus", action, message: result.message });
}

type Locale = "fr" | "en";
type Device = "desktop" | "wide" | "tablet" | "phone";
type Tab = "ajouter" | "medias" | "structure" | "reglages";
type SaveState = "idle" | "pending" | "saving" | "error";
/** Un pas d'historique : le brouillon, et l'instantané d'une planche ou du site (en-tête…) s'il a changé. */
/** Nouvel état du site calculé sur le dernier état écrit : état, refus (message) ou rien à écrire. */
type SiteUpdate = (cur: SiteSnap) => SiteSnap | { error: string } | null;
type HistoryEntry = { draft: PageDraft; board?: { projectId: number; snap: BoardSnap }; site?: SiteSnap };
/** Où insérer : la page (parent null) ou un conteneur. */
type Place = { parent: string | null; index: number };
type FromCanvasMsg = FromCanvas;
/** Messages de la toile qui portent un aperçu local (edit/optimistic.ts). */
const CANVAS_INTENTS = new Set<string>(["text", "site-text", "site-op", "form-field", "look", "site-style", "site-text-style", "site-zone-style", "site-look", "op", "move", "layout", "tile-size", "tile-op", "slot-text", "project-text", "surface", "background", "fond", "bitem-text", "bitem-look", "board-captions", "cell-look", "free-op", "media-look"]);
/** Fantôme d'envoi : ce que la toile affiche, plus le fichier et le média côté éditeur. */
type GhostItem = Ghost & { batch: string; file?: File; mediaId?: number; collection?: "characters" | "backgrounds" | "animation" };
/**
 * Geste sur une place de bande, le même pour les images du projet (emplacement `s12`) et pour un carrousel à liste propre
 * (place `<uid>.<rang>`, lot 31f) : l'opération de planche qui lui correspond.
 */
function slotBoardOp(key: string, act: { op: "remove" } | { op: "retire" } | { op: "fill"; mediaId: number } | { op: "move"; index: number }): BoardOp {
  const r = parseRailKey(key);
  if (!r) return { ...act, key } as BoardOp;
  switch (act.op) {
    case "remove":
      return { op: "rail-clear", uid: r.uid, at: r.at };
    case "retire":
      return { op: "rail-retire", uid: r.uid, at: r.at };
    case "fill":
      return { op: "rail-fill", uid: r.uid, at: r.at, mediaId: act.mediaId };
    case "move":
      return { op: "rail-move", uid: r.uid, at: r.at, index: act.index };
  }
}
/** Ce qui part vers la toile (ni fichier, ni identifiants internes). */
const toWire = (g: GhostItem): Ghost => ({
  id: g.id,
  board: g.board,
  ...(g.index !== undefined ? { index: g.index } : {}),
  ...(g.slot ? { slot: g.slot } : {}),
  ...(g.rail ? { rail: g.rail } : {}),
  label: g.label,
  ...(g.preview ? { preview: g.preview } : {}),
  aspect: g.aspect,
  progress: g.progress,
  phase: g.phase,
  ...(g.message ? { message: g.message.slice(0, 300) } : {}),
  ...(g.key ? { key: g.key } : {}),
});

const WIDE_PX = 1440;
const DEVICES: { id: Device; label: string; width: number | null }[] = [
  { id: "desktop", label: "Ordinateur", width: 1180 },
  // Grand écran (lot 57) : le rendu d'un écran de 1440 px, réduit par un zoom pour tenir dans la fenêtre.
  { id: "wide", label: "Grand écran", width: WIDE_PX },
  { id: "tablet", label: "Tablette", width: 820 },
  { id: "phone", label: "Téléphone", width: 390 },
];
const TABS: { id: Tab; label: string }[] = [
  { id: "ajouter", label: "Ajouter" },
  { id: "medias", label: "Médias" },
  { id: "structure", label: "Structure" },
  { id: "reglages", label: "Réglages" },
];
const DEBOUNCE_MS = 800;
const HISTORY_MAX = 100;
const MOBILE = "(max-width: 819px)";
/** Barre du haut (lot 24) : « Abandonner » passe dans le menu « Plus » sous 1360 px, la largeur d'aperçu sous 1180 px ; « Publier » reste visible. */
const TOP_TIGHT = "(max-width: 1360px)";
const TOP_TIGHTER = "(max-width: 1180px)";

/** Texte tel que l'artiste le lit : le mot mis en valeur (<mark>) entre « ». */
const readable = (text: string) => text.replace(/<mark>([\s\S]*?)<\/mark>/g, "« $1 »").replace(/<\/?mark>/g, "");

/** Les textes du brouillon (FR / EN), bloc par bloc : à copier avant de recharger. */
function draftTexts(draft: PageDraft, byType: Record<string, BlockCatalogEntry>): string {
  const out: string[] = [];
  // Parcourt aussi les composants des conteneurs (props.children).
  const walk = (v: unknown, lines: string[]) => {
    if (!v || typeof v !== "object") return;
    const l = v as { fr?: unknown; en?: unknown };
    if (typeof l.fr === "string" && typeof l.en === "string") {
      if (l.fr) lines.push(`FR : ${readable(l.fr)}`);
      if (l.en) lines.push(`EN : ${readable(l.en)}`);
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, lines);
  };
  draft.blocks.forEach((b, i) => {
    const lines: string[] = [];
    walk(b.props, lines);
    if (lines.length) out.push(`${i + 1}. ${own(byType, b.type)?.label ?? b.type}\n${lines.join("\n")}`);
  });
  return out.join("\n\n");
}

let seq = 0;
/** Identifiant d'un lot de fichiers déposés ensemble. */
const batchId = () => `b${Date.now().toString(36)}${(++seq).toString(36)}`;
/** Identifiant de bloc neuf, unique (format accepté par le brouillon). */
const newUid = () => `n${Date.now().toString(36)}${(++seq).toString(36)}`;

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Erreurs d'un bloc (publication refusée), relatives à ses props (`at` : « blocks.2.props.children.0 »). */
function blockErrors(errors: Record<string, string>, at: string | null): Record<string, string> {
  if (!at) return {};
  const prefix = `${at}.props.`;
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).startsWith("children."))
      .map(([k, v]) => [k.slice(prefix.length), v]),
  );
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export default function VisualEditor({
  pageId,
  initial,
  hasDraft: initialHasDraft,
  rev: initialRev,
  corrupt: initialCorrupt,
  overlaySlugs: initialOverlaySlugs,
  paths,
  pages,
  catalog,
  editors,
  context,
  siteName,
  initialLocale,
  site: initialSite,
  look: lookContext,
  themeChoices = [],
}: {
  pageId: number;
  initial: PageDraft;
  hasDraft: boolean;
  /** Adresses publiées de la page (la toile doit les afficher). */
  paths: Record<Locale, string>;
  pages: { id: number; title: string }[];
  catalog: BlockCatalogEntry[];
  editors: Record<string, React.ReactNode>;
  context: EditorContext;
  siteName: string;
  initialLocale: Locale;
  /** Version du contenu lue au chargement (contrôle optimiste). */
  rev: number;
  /** Brouillon enregistré mais illisible : rien n'est écrit avant un choix explicite. */
  corrupt: boolean;
  /** Projets dont la page a déjà modifié les images (surcouche en attente). */
  overlaySlugs: string[];
  /** En-tête, pied et réseaux (communs au site) : état vu depuis cette page. */
  site: { snap: SiteSnap; pending: boolean; rev: number };
  /** Mise en page (lot 2) : palette du thème, polices déjà téléchargées. */
  look: LookContext;
  /** Thèmes du menu « Thème » (lot 63) : en ligne d'abord, puis derniers utilisés. */
  themeChoices?: ThemeChoice[];
}) {
  const router = useRouter();
  const mobile = useMedia(MOBILE);
  const topTight = useMedia(TOP_TIGHT);
  const topTighter = useMedia(TOP_TIGHTER);
  // Par type : l'entrée du type lui-même (pas un raccourci de la palette).
  const byType = useMemo(() => Object.fromEntries(catalog.filter((c) => !c.preset).map((c) => [c.type, c])), [catalog]);
  /** Recherche d'un composant (onglet « Ajouter »). */
  const [addQuery, setAddQuery] = useState("");
  /** Composants proposés à l'ajout : groupes (src/blocks/groups.ts), filtrés par la recherche. */
  const addGroups = useMemo(() => pickerGroups(catalog, STARTER_LIST, addQuery), [catalog, addQuery]);

  /* ---- Brouillon et historique ------------------------------------------- */

  const [draft, setDraftState] = useState<PageDraft>(() => clone(initial));
  const draftRef = useRef(draft);
  // Historique hors état React (pas d'effets dans un updater) ; `historyRev` redessine.
  const history = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const [historyLen, setHistoryLen] = useState({ past: 0, future: 0 });
  const bumpHistory = () => setHistoryLen({ past: history.current.past.length, future: history.current.future.length });
  const coalesce = useRef<{ key: string; at: number } | null>(null);

  const [hasDraft, setHasDraft] = useState(initialHasDraft);
  const revRef = useRef(initialRev);
  // Écritures suspendues : page modifiée ailleurs, ou brouillon illisible.
  const [blocked, setBlocked] = useState<"conflict" | "corrupt" | null>(initialCorrupt ? "corrupt" : null);
  const blockedRef = useRef(blocked);
  const [resetting, setResetting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  // Avertissements NON bloquants de la dernière publication (lot 52) : images sans description, textes sans traduction.
  const [publishWarn, setPublishWarn] = useState<NonNullable<PublishResult["warnings"]> | null>(null);
  const [publishing, setPublishing] = useState(false);
  /** Première mise en ligne : confirmation avant que la page devienne visible par tous (lot 51). */
  const [askLive, setAskLive] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ajouter");
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [device, setDevice] = useState<Device>("desktop");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [sheet, setSheet] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Planches (avec images modifiées) que la suppression demandée retirerait. */
  const [deletingLost, setDeletingLost] = useState<string[]>([]);
  /** « Ajouter une rubrique » ouvert depuis la toile : l'endroit visé (lot 17c). */
  const [adding, setAdding] = useState<Place | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);

  const frameRef = useRef<HTMLIFrameElement>(null);
  // Bascule FR / EN (lot 87) : où l'on était dans la toile, remis en place quand la nouvelle langue est affichée (src/lib/lang-scroll.ts).
  const langSnap = useRef<LangSnap | null>(null);
  const langSettle = useRef<(() => void) | null>(null);
  const restoreLangScroll = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    const snap = langSnap.current;
    if (!win || !snap) return;
    langSettle.current?.();
    try {
      langSettle.current = settleSnap(win, snap);
    } catch {
      // Toile pas encore prête : le message « ready » réessaie.
    }
  }, []);
  const [frameReady, setFrameReady] = useState(false);
  const [foreign, setForeign] = useState(false);
  const [canvasBlocks, setCanvasBlocks] = useState<BlockInfo[]>([]);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dropRefused, setDropRefused] = useState(false);
  /** Lot 77 (MENU-11) : une fenêtre modale est ouverte dans la toile (« Cadrer l'image ») : panneau et barre voilés. */
  const [canvasModal, setCanvasModal] = useState(false);
  /** Endroit visé par un composant glissé de la palette : la page ou un conteneur. */
  const dropIndexRef = useRef<Place | null>(null);

  const send = useCallback((msg: ToCanvas) => {
    frameRef.current?.contentWindow?.postMessage({ type: EDIT_MSG, ...msg }, window.location.origin);
  }, []);

  /* ---- Enregistrement automatique ---------------------------------------- */

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  // État RÉEL pour le garde de sortie : dernier brouillon accepté par le
  // serveur, envoi en cours, départ volontaire (abandon → rechargement).
  const savedJson = useRef(JSON.stringify(draft));
  const inFlight = useRef(false);
  const leaving = useRef(false);
  // Toutes les écritures (brouillon, planches, publication, abandon) passent
  // l'une après l'autre : chacune porte la version laissée par la précédente.
  const lock = useRef<Promise<unknown>>(Promise.resolve());
  // Écritures en cours ou en file (dont celle qui s'exécute) : le serveur n'a pas tout acquitté.
  const lockDepth = useRef(0);
  const withLock = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    lockDepth.current++;
    const run = lock.current.then(fn, fn);
    const done = () => {
      lockDepth.current--;
    };
    run.then(done, done);
    lock.current = run.catch(() => undefined);
    return run;
  }, []);

  /* État local de la toile (edit/optimistic.ts) : la toile garde ses aperçus tant que le
     serveur n'a pas acquitté une révision au moins aussi récente. */
  // Dernier numéro d'intention reçu de la toile.
  const seenSeq = useRef(0);
  // Intentions en préparation (téléchargement d'une police avant de modifier le brouillon…).
  const working = useRef(0);
  /** Rien n'est en attente d'enregistrement, ni en vol, ni en préparation. `inLock` : l'appelant tient le verrou. */
  const quiet = useCallback((inLock: boolean) => !dirty.current && lockDepth.current <= (inLock ? 1 : 0) && working.current === 0, []);
  /** Message de rafraîchissement : révision écrite et, si tout est acquitté, jusqu'où la toile peut lâcher ses aperçus. */
  const refreshMsg = useCallback((inLock: boolean): ToCanvas => ({ kind: "refresh", rev: revRef.current, upTo: quiet(inLock) ? seenSeq.current : -1 }), [quiet]);
  /** Une intention n'a rien changé ou vient d'aboutir sans écriture : la toile peut lâcher ses aperçus. */
  const settleIfQuiet = useCallback(() => {
    if (quiet(false)) send({ kind: "settle", rev: revRef.current, upTo: seenSeq.current });
  }, [quiet, send]);

  /** Refus « modifié ailleurs » ou « brouillon illisible » : l'éditeur s'arrête. */
  const stop = useCallback((code: "conflict" | "corrupt") => {
    blockedRef.current = code;
    setBlocked(code);
    setSaveState("idle");
  }, []);

  /** Enregistre le brouillon (dans le verrou). */
  const runSave = useCallback(async (final = false): Promise<boolean> => {
    let ok = true;
    while (dirty.current) {
      dirty.current = false;
      setSaveState("saving");
      if (blockedRef.current) {
        ok = false;
        break;
      }
      const snapshot = draftRef.current;
      let result: Awaited<ReturnType<typeof saveDraftAction>>;
      inFlight.current = true;
      try {
        result = await saveDraftAction(pageId, snapshot, revRef.current);
      } catch {
        result = lostConnection("saveDraftAction");
      } finally {
        inFlight.current = false;
      }
      if (!result.ok) {
        reportSaveFailure("saveDraftAction", result);
        ok = false;
        dirty.current = true;
        if ("code" in result) stop(result.code);
        else {
          setSaveState("error");
          setSaveError(result.message);
        }
        break;
      }
      revRef.current = result.data.rev;
      savedJson.current = JSON.stringify(snapshot);
      setHasDraft(true);
    }
    if (ok) {
      setSaveState("idle");
      setSaveError(null);
      // `final` : cet enregistrement est tout ce que le verrou fait ; sinon une autre écriture suit.
      send(final ? refreshMsg(true) : { kind: "refresh", rev: revRef.current, upTo: -1 });
    }
    return ok;
  }, [pageId, refreshMsg, send, stop]);

  // Palette / logo en attente d'enregistrement (lot 17f) : validés avant tout enregistrement ou publication.
  const commitLookRef = useRef<() => Promise<void>>(async () => {});
  // Réglages d'un composant de planche en attente d'écriture (saisie : une écriture après 600 ms de calme).
  const itemFlushRef = useRef<() => Promise<void>>(async () => {});
  const flush = useCallback(async (): Promise<boolean> => {
    await itemFlushRef.current();
    await commitLookRef.current();
    clearTimeout(timer.current);
    return withLock(async () => (dirty.current ? runSave(true) : true));
  }, [runSave, withLock]);

  const schedule = useCallback(
    (delay: number) => {
      dirty.current = true;
      setSaveState((s) => (s === "saving" ? s : "pending"));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  /* ---- Planches : surcouche d'emplacements de la page (phase 7b) ---------- */

  // Dernier instantané connu de chaque planche touchée (pour Annuler/Rétablir).
  const boards = useRef(new Map<number, BoardSnap>());
  // Planches dont cette page a modifié les images (surcouche non vide).
  const overlaySlugs = useRef(new Set(initialOverlaySlugs));
  const [boardBusy, setBoardBusy] = useState(0);

  /* ---- En-tête, pied, réseaux : brouillon du site (v0.13) ------------------ */

  const siteRef = useRef<SiteSnap>(initialSite.snap);
  const [siteSnap, setSiteSnap] = useState<SiteSnap>(initialSite.snap);
  const [sitePending, setSitePending] = useState(initialSite.pending);
  // Version du brouillon COMMUN du site (lot 96) : indépendante de celle de la page.
  const siteRevRef = useRef(initialSite.rev);
  const [discardingSite, setDiscardingSite] = useState(false);
  const [discardSiteBusy, setDiscardSiteBusy] = useState(false);
  // Défini plus bas (après runSave) ; appelé par l'historique.
  const writeSiteRef = useRef<(next: SiteSnap | SiteUpdate, record?: boolean) => Promise<boolean>>(async () => false);

  /**
   * Écrit sur une planche (opération ou instantané), après le brouillon en
   * attente. Renvoie le résultat, ou null si refusé (message affiché).
   */
  /** Le serveur a écrit le contenu propre dans un bloc du brouillon : le brouillon de l'éditeur reçoit la même écriture (sinon son prochain enregistrement l'effacerait). */
  const syncOwnBlock = useCallback((list: { uid: string; layout: BoardItem[] | null; text: unknown }[]) => {
    const prev = draftRef.current;
    const inSync = JSON.stringify(prev) === savedJson.current;
    let blocks = prev.blocks;
    for (const b of list) {
      blocks = updateBlock(blocks, b.uid, (x) => {
        const props = { ...x.props };
        if (b.layout) props.layout = b.layout;
        else delete props.layout;
        if (b.text) props.text = b.text;
        else delete props.text;
        return { ...x, props };
      });
    }
    if (blocks === prev.blocks) return;
    const next = { ...prev, blocks };
    draftRef.current = next;
    setDraftState(next);
    if (inSync) savedJson.current = JSON.stringify(next);
  }, []);

  const writeBoard = useCallback(
    (call: (rev: number) => ReturnType<typeof boardAction>): Promise<BoardResult | null> =>
      withLock(async () => {
        if (blockedRef.current) return null;
        if (dirty.current && !(await runSave())) return null;
        setBoardBusy((n) => n + 1);
        setSaveState("saving");
        try {
          let result: Awaited<ReturnType<typeof boardAction>>;
          try {
            result = await call(revRef.current);
          } catch {
            result = lostConnection("boardAction");
          }
          if (!result.ok) {
            reportSaveFailure("boardAction", result);
            if ("code" in result) stop(result.code);
            else {
              setSaveState("idle");
              toast(result.message, "error");
            }
            return null;
          }
          revRef.current = result.data.rev;
          if (result.data.blocks?.length) syncOwnBlock(result.data.blocks);
          boards.current.set(result.data.after.projectId, result.data.after);
          syncItemRef.current(result.data.after);
          if (result.data.slug) overlaySlugs.current.add(result.data.slug);
          setHasDraft(true);
          setSaveState("idle");
          setSaveError(null);
          send(refreshMsg(true));
          return result.data;
        } finally {
          setBoardBusy((n) => n - 1);
        }
      }),
    [refreshMsg, runSave, send, stop, syncOwnBlock, withLock],
  );

  /**
   * Écrit le brouillon COMMUN du site (en-tête, pied, réseaux, menu, styles) après le brouillon en
   * attente, avec la version du brouillon du site. `record` : inscrit dans l'historique.
   * `next` peut être une fonction : elle est appelée DANS le verrou, sur le dernier état
   * écrit (jamais sur un état antérieur à une écriture encore en vol) ; elle renvoie le
   * nouvel état, `{ error }` (message affiché, rien n'est écrit) ou null (rien à écrire).
   */
  const writeSite = useCallback(
    (next: SiteSnap | SiteUpdate, record = true): Promise<boolean> =>
      withLock(async () => {
        if (blockedRef.current) return false;
        if (dirty.current && !(await runSave())) return false;
        const snap = typeof next === "function" ? next(siteRef.current) : next;
        if (!snap) return false;
        if ("error" in snap) {
          toast(snap.error, "error");
          return false;
        }
        setSaveState("saving");
        let result: Awaited<ReturnType<typeof siteDraftAction>>;
        try {
          result = await siteDraftAction(pageId, snap, siteRevRef.current, revRef.current);
        } catch {
          result = lostConnection("siteDraftAction");
        }
        if (!result.ok) {
          reportSaveFailure("siteDraftAction", result);
          if ("code" in result) stop(result.code);
          else {
            setSaveState("idle");
            toast(result.message, "error");
          }
          return false;
        }
        siteRevRef.current = result.data.rev;
        if (typeof result.data.pageRev === "number") revRef.current = result.data.pageRev;
        if (record) {
          history.current = { past: [...history.current.past, { draft: draftRef.current, site: result.data.before }].slice(-HISTORY_MAX), future: [] };
          coalesce.current = null;
          bumpHistory();
        }
        siteRef.current = snap;
        setSiteSnap(snap);
        setSitePending(result.data.pending);
        setSaveState("idle");
        setSaveError(null);
        send(refreshMsg(true));
        return true;
      }),
    [pageId, refreshMsg, runSave, send, stop, withLock],
  );
  useEffect(() => {
    writeSiteRef.current = writeSite;
  }, [writeSite]);

  // Bloqué (modifié ailleurs) : « Recharger » est un choix explicite, pas de garde.
  // Le garde ne retient que ce qui n'est vraiment pas enregistré : brouillon
  // différent du dernier accepté, envoi en cours, erreur, planche en cours.
  useUnsavedGuard(
    !blocked && (saveState === "pending" || saveState === "saving" || saveState === "error" || boardBusy > 0),
    () => !leaving.current && (inFlight.current || boardBusy > 0 || saveState === "error" || JSON.stringify(draftRef.current) !== savedJson.current),
  );

  /** Applique une modification : historique, état, enregistrement. */
  const apply = useCallback(
    (next: PageDraft, opts: { key?: string; structural?: boolean } = {}) => {
      if (blockedRef.current) {
        toast(blockedRef.current === "conflict" ? "Page modifiée ailleurs : recharge avant de continuer." : "Brouillon illisible : repars d'abord de la version publiée.", "error");
        return;
      }
      const now = Date.now();
      const merge = opts.key && coalesce.current?.key === opts.key && now - coalesce.current.at < 1200;
      const prev = draftRef.current;
      // Rien de changé (la toile renvoie un état identique) : ni historique ni enregistrement.
      if (next === prev || JSON.stringify(next) === JSON.stringify(prev)) return;
      // Ce qui a refusé la publication n'est plus vrai du brouillon modifié : le bandeau et les erreurs repartent au prochain « Publier ».
      setPublishMessage(null);
      setPublishErrors({});
      history.current = { past: merge ? history.current.past : [...history.current.past, { draft: prev }].slice(-HISTORY_MAX), future: [] };
      bumpHistory();
      coalesce.current = opts.key ? { key: opts.key, at: now } : null;
      draftRef.current = next;
      setDraftState(next);
      schedule(opts.structural ? 0 : DEBOUNCE_MS);
    },
    [schedule],
  );

  /** Opération sur une planche, inscrite dans l'historique. */
  const boardDo = useCallback(
    async (projectId: number, op: BoardOp): Promise<BoardResult | null> => {
      if (blockedRef.current) return null;
      const draftBefore = draftRef.current;
      const result = await writeBoard((rev) => boardAction(pageId, projectId, op, rev));
      if (!result) return null;
      // Rien n'a changé (texte identique) : pas de pas d'historique.
      if (JSON.stringify(result.before) === JSON.stringify(result.after)) return result;
      // Contenu propre à la page (lot 111) : le brouillon d'AVANT l'écriture (le bloc porte l'ancien contenu), sinon Annuler le réécrirait.
      history.current = { past: [...history.current.past, { draft: result.blocks?.length ? draftBefore : draftRef.current, board: { projectId, snap: result.before } }].slice(-HISTORY_MAX), future: [] };
      coalesce.current = null;
      bumpHistory();
      return result;
    },
    [pageId, writeBoard],
  );

  /** Revient à une entrée de l'historique ; renvoie l'entrée qui la remplace (sens inverse). */
  /**
   * Revient à une entrée de l'historique ; renvoie l'entrée qui la remplace
   * (sens inverse), ou null si le serveur refuse de rétablir la planche
   * (ex. image supprimée entre-temps) : l'historique ne bouge pas.
   */
  const travel = useCallback(
    async (entry: HistoryEntry): Promise<HistoryEntry | null> => {
      const back: HistoryEntry = { draft: draftRef.current };
      if (entry.site) {
        back.site = siteRef.current;
        if (!(await writeSiteRef.current(entry.site, false))) return null;
      }
      if (entry.board) {
        const current = boards.current.get(entry.board.projectId);
        if (current) back.board = { projectId: entry.board.projectId, snap: current };
        const target = entry.board.snap;
        const restored = await writeBoard((rev) => restoreBoardAction(pageId, target, rev, current));
        if (!restored) return null;
      }
      if (entry.draft !== draftRef.current) {
        draftRef.current = entry.draft;
        setDraftState(entry.draft);
        coalesce.current = null;
        schedule(0);
      }
      return back;
    },
    [pageId, schedule, writeBoard],
  );

  const traveling = useRef(false);
  const undo = useCallback(async () => {
    if (blockedRef.current || traveling.current) return;
    traveling.current = true;
    try {
      await commitLookRef.current();
      // Les écritures en cours finissent d'abord : leur pas d'historique existe avant qu'on revienne en arrière.
      await lock.current;
      const entry = history.current.past.at(-1);
      if (!entry) return;
      // La toile ne peut pas deviner le résultat : état « en cours » jusqu'à l'acquittement.
      send({ kind: "pending", label: "Retour en arrière en cours…" });
      const back = await travel(entry);
      if (!back) {
        toast("Impossible de défaire ce pas : le projet a changé (image supprimée ?).", "error");
        return;
      }
      const h = history.current;
      history.current = { past: h.past.filter((e) => e !== entry), future: [back, ...h.future] };
      bumpHistory();
      toast("Action défaite");
    } finally {
      traveling.current = false;
      // Rien à enregistrer (refus, pas sans effet) : plus rien à attendre. Sinon l'acquittement lève l'état.
      if (quiet(false)) send({ kind: "pending", label: null });
    }
  }, [travel, send, quiet]);

  const redo = useCallback(async () => {
    if (blockedRef.current || traveling.current) return;
    traveling.current = true;
    try {
      await commitLookRef.current();
      await lock.current;
      const entry = history.current.future[0];
      if (!entry) return;
      send({ kind: "pending", label: "Rétablissement en cours…" });
      const back = await travel(entry);
      if (!back) {
        toast("Rétablissement impossible pour ce pas : le projet a changé (image supprimée ?).", "error");
        return;
      }
      const h = history.current;
      history.current = { past: [...h.past, back], future: h.future.filter((e) => e !== entry) };
      bumpHistory();
      toast("Rétabli");
    } finally {
      traveling.current = false;
      if (quiet(false)) send({ kind: "pending", label: null });
    }
  }, [travel, send, quiet]);

  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  /* ---- Opérations sur les blocs ------------------------------------------ */

  const blocks = draft.blocks;
  /** Types déjà posés sur la page (composants compris) : grise l'ajout d'un composant « une seule fois par page ». */
  const present = useMemo(() => new Set(walkTree(blocks).map((v) => v.block.type)), [blocks]);
  const setBlocks = (next: DraftBlock[], opts: { key?: string; structural?: boolean } = { structural: true }) =>
    apply({ ...draftRef.current, blocks: next }, opts);

  const selectBlock = useCallback(
    (uid: string | null, opts: { scroll?: boolean; notify?: boolean } = {}) => {
      setSelected(uid);
      if (opts.notify !== false) send({ kind: "select", uid, scroll: opts.scroll });
    },
    [send],
  );

  /** Le bloc choisi est-il un conteneur qui accepte ce type ? Sinon sa liste. */
  const defaultPlace = (type: string): Place => {
    const list = draftRef.current.blocks;
    if (selected && !selected.startsWith("site-")) {
      const block = findBlock(list, selected);
      if (block && isContainer(block.type) && canPlace(list, { type, props: {} }, selected)) return { parent: selected, index: listOf(list, selected)?.length ?? 0 };
      const at = locate(list, selected);
      if (at && canPlace(list, { type, props: {} }, at.parent)) return { parent: at.parent, index: at.index + 1 };
    }
    return { parent: null, index: list.length };
  };

  /** Ajoute un composant de la palette (clé : type ou raccourci) à un endroit, ou après le bloc choisi. */
  const insert = (key: string, at?: Place, opts?: { props?: Record<string, unknown>; edit?: string }) => {
    const def = catalog.find((c) => c.key === key && !c.hidden);
    if (!def) return;
    const list = draftRef.current.blocks;
    // Une seule fois par page (l'Ouverture) : le panneau grise déjà l'ajout, ceci couvre le glisser et le « + » de la toile.
    if (def.single && walkTree(list).some((v) => v.block.type === def.type)) {
      toast(def.single, "error");
      return;
    }
    const place = at ?? defaultPlace(def.type);
    if (place.parent === null && list.length >= 40) {
      toast("40 blocs au plus par page.", "error");
      return;
    }
    // Titre inséré tout en haut d'une page (aucun bloc avant) sans titre principal (ni ouverture, qui porte le sien) : il l'est (h1) ; un titre de section sinon (lot 22).
    const principal =
      def.type === "section-title" && place.parent === null && place.index === 0 && !list.some((b) => b.type === "hero" || b.type === "profile" || (b.type === "section-title" && b.props.main === true));
    // Un Profil posé sur une page qui a déjà une Ouverture ne répète pas le nom (elle l'affiche déjà ; lot 27).
    const nameOnce = def.type === "profile" && list.some((b) => b.type === "hero");
    const block = withFreshUids({ uid: "", type: def.type, props: clone({ ...def.defaults, ...(principal ? { main: true } : {}), ...(nameOnce ? { showName: false } : {}), ...opts?.props }) } as DraftBlock, newUid);
    const next = insertBlock(list, block, place.parent, place.index);
    if (!next) {
      const parent = place.parent ? findBlock(list, place.parent) : null;
      toast(parent ? `« ${own(byType, parent.type)?.label ?? "Ce bloc"} » n'accepte pas « ${def.label} » (ou il est plein).` : "Impossible d'ajouter ce bloc ici.", "error");
      return;
    }
    setBlocks(next);
    selectBlock(block.uid, { scroll: true });
    // Rubrique Texte neuve : la toile ouvre l'édition en place, son texte d'aide sélectionné.
    if (opts?.edit) send({ kind: "edit-text", uid: block.uid, path: opts.edit });
    toast(`« ${def.label} » ajouté${place.parent ? ` dans « ${own(byType, findBlock(list, place.parent)?.type ?? "")?.label ?? "le bloc"} »` : ""}`);
    if (mobile) setSheet(false);
  };

  /** Le texte d'aide n'est posé que dans la langue qu'on édite : l'autre reste vide, comme tout texte neuf. */
  const helpIn = (v: { fr: string; en: string }) => ({ fr: locale === "fr" ? v.fr : "", en: locale === "en" ? v.en : "" });

  /** Rubrique de texte (« Texte », « Titre », « Titre + texte ») : le bloc et ses seuls champs voulus, avec leur texte d'aide, édité aussitôt. */
  const insertStarter = (starter: TextStarter, at?: Place) => {
    const s = TEXT_STARTERS[starter];
    const props: Record<string, unknown> = {};
    if ("title" in s.props) props.title = helpIn(s.props.title);
    if ("paragraphs" in s.props) props.paragraphs = s.props.paragraphs.map(helpIn);
    insert(s.block, at, { props, edit: s.edit });
  };

  /**
   * Champ facultatif ajouté ou retiré depuis la toile : le titre d'un bloc Texte (« + Ajouter un titre » / « Retirer le
   * titre »), l'étiquette, la présentation et les compteurs d'un bloc Titre. Un champ ajouté s'édite aussitôt ; false =
   * refusé ou sans effet.
   */
  const fieldOp = (uid: string, op: Extract<FromCanvas, { kind: "field-op" }>["op"]): boolean => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, uid);
    // Titre de composant (lot 128) : `props.head` (titre, sous-titre, dessous / sur l'image), src/blocks/head.ts ; un titre ajouté s'édite aussitôt.
    if (block && /^(add|remove)-head(-|$)/.test(op)) {
      const done = applyHeadOp(block.type, block.props, op);
      if (!done) return false;
      setBlocks(updateBlock(list, uid, (b) => ({ ...b, props: done.props })), { structural: true });
      selectBlock(uid);
      if (done.edit) send({ kind: "edit-text", uid, path: done.edit });
      return true;
    }
    // Grille, Contact, Profil, CV (lot 27) : table de src/blocks/optional-fields.ts.
    const named = /^(add|remove)-(.+)$/.exec(op);
    const def = block && named ? fieldOpDef(block.type, named[2]) : undefined;
    if (block && def && named) {
      const add = named[1] === "add";
      if (add === hasOptionalField(def, block.props)) return false;
      setBlocks(updateBlock(list, uid, (b) => ({ ...b, props: withOptionalField(def, b.props, add) })), { structural: true });
      selectBlock(uid);
      if (add && def.kind === "text") send({ kind: "edit-text", uid, path: def.prop });
      return true;
    }
    const [verb, field] = op.split("-") as ["add" | "remove", "title" | "eyebrow" | "intro" | "counts"];
    // Titre : bloc Texte. Étiquette : bloc Titre, ou bloc Texte qui en porte une (« Retirer l'étiquette » seulement). Présentation, compteurs : bloc Titre.
    const okType = field === "title" ? block?.type === "rich-text" : block?.type === "section-title" || (block?.type === "rich-text" && op === "remove-eyebrow");
    if (!block || !okType || (field !== "title" && block.type === "section-title" && block.props.linked)) return false;
    const props = { ...block.props };
    const has = field === "counts" ? props.counts === true : props[field] !== undefined;
    if ((verb === "add") === has) return false;
    if (verb === "remove") delete props[field];
    else if (field === "counts") props.counts = true;
    else props[field] = field === "title" ? helpIn(HELP_TEXT.title) : { fr: "", en: "" };
    setBlocks(updateBlock(list, uid, (b) => ({ ...b, props })), { structural: true });
    selectBlock(uid);
    if (verb === "add" && field !== "counts") send({ kind: "edit-text", uid, path: field });
    return true;
  };

  /**
   * Entrées des collections choisies à la main, depuis la toile : ajoute une page de collection qui n'a pas encore
   * d'entrée (textes de son Titre), retire, monte ou descend une entrée. false = refusé ou sans effet.
   */
  const tileOp = (msg: { uid: string; op: "add" | "remove" | "up" | "down" | "cover" | "cover-clear" | "mode-manual" | "mode-auto"; index?: number; pageId?: number }): boolean => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, msg.uid);
    // Lot 105 : passer des entrées automatiques à la liste choisie à la main (réordonner, retirer) et inversement, depuis la barre du bloc (comme dans les Réglages).
    if (block?.type === "collection-tiles" && (msg.op === "mode-manual" || msg.op === "mode-auto")) {
      const found = context.collectionPages ?? [];
      const props = { ...block.props } as Record<string, unknown>;
      if (msg.op === "mode-manual") {
        if (tilesMode(props) === "manual") return false;
        delete props.edits;
        props.mode = "manual";
        props.items = itemsFromEntries(autoEntries(found, (block.props.edits as TileEdit[] | undefined) ?? []));
      } else {
        if (tilesMode(props) === "auto") return false;
        const kept = editsFromItems(((block.props.items as TileItem[] | undefined) ?? []).filter((i) => i.pageId !== undefined && i.collection !== undefined && (COLLECTION_KEYS as readonly string[]).includes(i.collection)), found);
        delete props.items;
        props.mode = "auto";
        if (kept.length) props.edits = kept;
      }
      setBlocks(updateBlock(list, msg.uid, (b) => ({ ...b, props })), { structural: true });
      return true;
    }
    if (block?.type === "collection-tiles" && msg.op === "cover") {
      // Couverture de l'entrée (lot 26) : choix d'une image de la médiathèque ou envoi, dans les deux modes.
      setTileCover({ uid: msg.uid, ...(msg.index !== undefined ? { index: msg.index } : {}), ...(msg.pageId !== undefined ? { pageId: msg.pageId } : {}) });
      return true;
    }
    if (block?.type === "collection-tiles" && msg.op === "cover-clear") return applyTileCover({ uid: msg.uid, index: msg.index, pageId: msg.pageId }, undefined);
    if (!block || block.type !== "collection-tiles" || block.props.mode === "auto" || msg.op === "cover" || msg.op === "cover-clear") return false;
    const items = [...((block.props.items as { pageId?: number }[] | undefined) ?? [])];
    if (msg.op === "add") {
      const page = (context.entryPages ?? context.collectionPages)?.find((p) => p.pageId === msg.pageId);
      if (!page || items.length >= MAX_TILES || items.some((i) => i.pageId === page.pageId)) return false;
      items.push({ ...(page.collection ? { collection: page.collection } : {}), pageId: page.pageId, eyebrow: page.eyebrow, title: page.title, intro: page.intro } as (typeof items)[number]);
    } else {
      const i = msg.index;
      if (i === undefined || i >= items.length) return false;
      if (msg.op === "remove") items.splice(i, 1);
      else {
        const j = msg.op === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= items.length) return false;
        [items[i], items[j]] = [items[j], items[i]];
      }
    }
    setBlocks(updateBlock(list, msg.uid, (b) => ({ ...b, props: { ...b.props, items } })), { structural: true });
    return true;
  };

  /**
   * Couverture d'une entrée de collection choisie sur la tuile (lot 26) : `mediaId` (image de la médiathèque) posé sur l'entrée
   * (liste manuelle : `items[i]` ; automatique : `edits[]`, attaché à la page) ; undefined = la couverture de la collection. Le
   * cadrage de la tuile est retiré (il visait l'ancienne image). false = refusé ou sans effet.
   */
  const applyTileCover = (target: { uid: string; index?: number; pageId?: number }, mediaId: number | undefined): boolean => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, target.uid);
    if (!block || block.type !== "collection-tiles") return false;
    const props = { ...block.props } as Record<string, unknown>;
    type Cover = { pageId?: number; collection?: string; mediaId?: number } & Record<string, unknown>;
    let collection: string | undefined;
    if (props.mode === "auto") {
      const page = context.collectionPages?.find((p) => p.pageId === target.pageId);
      if (!page) return false;
      collection = page.collection;
      const edits = [...((props.edits as Cover[] | undefined) ?? [])];
      const at = edits.findIndex((e) => e.pageId === page.pageId);
      const current = at >= 0 ? edits[at] : { pageId: page.pageId };
      if (current.mediaId === mediaId) return false;
      const { mediaId: _old, ...rest } = current;
      void _old;
      const next: Cover = mediaId === undefined ? rest : { ...rest, mediaId };
      if (at >= 0) edits.splice(at, 1, next);
      else edits.push(next);
      const kept = edits.filter((e) => Object.keys(e).length > 1);
      if (kept.length) props.edits = kept;
      else delete props.edits;
    } else {
      const items = [...((props.items as Cover[] | undefined) ?? [])];
      const i = target.index ?? items.findIndex((it) => it.pageId === target.pageId);
      if (i === undefined || i < 0 || i >= items.length) return false;
      collection = items[i].collection;
      if (items[i].mediaId === mediaId) return false;
      const { mediaId: _old, ...rest } = items[i];
      void _old;
      items[i] = mediaId === undefined ? rest : { ...rest, mediaId };
      props.items = items;
    }
    const look = readLook(props.look);
    if (collection && look?.tileCrop && (look.tileCrop as Record<string, unknown>)[collection]) {
      const { [collection as keyof typeof look.tileCrop]: _crop, ...tileCrop } = look.tileCrop;
      void _crop;
      const nextLook = cleanLook({ ...look, tileCrop });
      if (nextLook) props.look = nextLook;
      else delete props.look;
    }
    setBlocks(updateBlock(list, target.uid, (b) => ({ ...b, props })), { structural: true });
    toast(mediaId === undefined ? "Couverture de la collection rétablie" : "Couverture choisie", "success", { label: "Annuler", run: () => void undoRef.current() });
    return true;
  };
  const [tileCover, setTileCover] = useState<{ uid: string; index?: number; pageId?: number } | null>(null);

  /** Demande de la toile : choix illustré, ou texte tout de suite, à cet endroit. */
  const requestInsert = (parent: string | null, index: number, what: "choose" | "free" | TextStarter) => {
    if (what === "choose") setAdding({ parent, index });
    else if (what === "free") insert("free-board", { parent, index });
    else insertStarter(what, { parent, index });
  };

  /**
   * Grille unifiée (lot 31d) : le choix du média d'une case s'ouvre ; il est posé dans cette case (remplacée), ou à la suite
   * des images quand la case est libre. `board` : la grille est un composant de planche (sinon une rubrique de la page).
   */
  const [cellPick, setCellPick] = useState<{ uid: string; board?: number; props?: string; index: number; kind?: "image" | "video" } | null>(null);
  const requestCellMedia = (uid: string, kind: "image" | "video") => {
    const grid = findBlock(draftRef.current.blocks, uid);
    if (grid?.type === "grid") setCellPick({ uid, index: Array.isArray(grid.props.children) ? grid.props.children.length : 0, kind });
  };

  /** Réglages d'une grille (rubrique de la page, ou composant de planche) tels que l'éditeur les connaît ; `fallback` : ceux que la toile a lus. */
  const gridBase = (uid: string, board?: number, fallback?: string): Record<string, unknown> | null => {
    if (!board) {
      const b = findBlock(draftRef.current.blocks, uid);
      return b && b.type === "grid" ? b.props : null;
    }
    const item = boards.current.get(board)?.layout.find((i) => i.uid === uid);
    if (item) return item.type === "grid" ? item.props : null;
    try {
      const v = JSON.parse(fallback ?? "null") as { props?: unknown } | null;
      return v?.props && typeof v.props === "object" && !Array.isArray(v.props) ? (v.props as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  /** Écrit les réglages d'une grille : le brouillon de la page (Annuler suit l'historique), ou la planche du projet (instantané). */
  const gridWrite = async (uid: string, board: number | undefined, props: Record<string, unknown>): Promise<boolean> => {
    if (board) return Boolean(await boardDo(board, { op: "item-set", uid, props }));
    const list = draftRef.current.blocks;
    if (!findBlock(list, uid)) return false;
    setBlocks(updateBlock(list, uid, (b) => ({ ...b, props })));
    return true;
  };
  const gridKids = (props: Record<string, unknown> | null): GridChild[] => (Array.isArray(props?.children) ? (props!.children as GridChild[]) : []);

  /** Un média posé dans la case n° `index` d'une grille (au-delà de la dernière image : à la suite). */
  const gridPut = async (uid: string, board: number | undefined, index: number, mediaId: number, hint?: string, fallback?: string): Promise<boolean> => {
    if (blockedRef.current) return false;
    if (board) await itemFlushRef.current();
    const base = gridBase(uid, board, fallback);
    if (!base) {
      toast("Cette grille n'existe plus : recharge l'éditeur.", "error");
      return false;
    }
    const kind = mediaKindOf(mediaId, hint);
    if (kind === "pdf") {
      toast("Un PDF se pose dans un bloc « CV ».", "error");
      return false;
    }
    const type = kind === "video" ? "video-single" : "image";
    const child: GridChild = { uid: newUid(), type, props: type === "video-single" ? { variant: "card", mode: "player", mediaId } : { width: "wide", mediaId } };
    const n = gridKids(base).length;
    const res = applyGridOp(base, { op: "put", index: Math.min(index, n), child });
    if ("error" in res) {
      toast(res.error, "error");
      return false;
    }
    const ok = await gridWrite(uid, board, res.props);
    if (ok) toast(index < n ? "Image remplacée" : `${type === "video-single" ? "Vidéo" : "Image"} placée en case ${n + 1}`, "success", { label: "Défaire", run: () => void undoRef.current() });
    return ok;
  };

  /** Format de chaque image de la grille (largeur / hauteur), d'après la médiathèque : sert à « Adapter aux images ». */
  const gridRatios = (props: Record<string, unknown>): number[] =>
    gridKids(props).map((c) => {
      const row = context.media.find((m) => m.id === c.props.mediaId);
      return row?.width && row?.height ? row.width / row.height : c.type === "video-single" ? 16 / 9 : 1.5;
    });

  /** Opération de la grille (barre de la toile, panneau) : les mêmes pour une rubrique de page et un composant de planche. */
  const gridOp = async (msg: Extract<FromCanvas, { kind: "grid-op" }>): Promise<boolean> => {
    if (blockedRef.current) return false;
    if (msg.board) await itemFlushRef.current();
    const base = gridBase(msg.uid, msg.board, msg.props);
    if (!base) {
      toast("Cette grille n'existe plus : recharge l'éditeur.", "error");
      return false;
    }
    const op = msg.op;
    if (op.op === "pick") {
      const kids = gridKids(base);
      const index = Math.min(op.index, kids.length);
      const kind = op.media ?? (kids[index] ? (kids[index].type === "video-single" ? "video" : "image") : undefined);
      setCellPick({ uid: msg.uid, ...(msg.board ? { board: msg.board, ...(msg.props ? { props: msg.props } : {}) } : {}), index, ...(kind ? { kind } : {}) });
      return true;
    }
    const model: GridModelOp = op.op === "adapt" ? { op: "adapt", ratios: op.ratios ?? gridRatios(base) } : (op as GridModelOp);
    const res = applyGridOp(base, model, gridRatios(base));
    if ("error" in res) {
      toast(res.error, "error");
      return false;
    }
    if (JSON.stringify(res.props) === JSON.stringify(base)) return false;
    const ok = await gridWrite(msg.uid, msg.board, res.props);
    if (ok && op.op === "adapt") toast("Disposition adaptée aux images", "success", { label: "Défaire", run: () => void undoRef.current() });
    if (ok && op.op === "remove") toast("Image retirée de la grille", "success", { label: "Défaire", run: () => void undoRef.current() });
    return ok;
  };

  /**
   * Planche libre (lot 42), page ou planche de projet : les images se posent et se règlent par `applyFreeOp` (src/blocks/free-board.ts),
   * le même modèle pour la toile, le panneau et les tests. Un geste = une écriture = un pas d'historique (Annuler / Rétablir).
   */
  const [freePick, setFreePick] = useState<{ uid: string; board?: number; props?: string; id?: string; poster?: boolean } | null>(null);
  const freeBase = (uid: string, board?: number, fallback?: string): Record<string, unknown> | null => {
    if (!board) {
      const b = findBlock(draftRef.current.blocks, uid);
      return b && b.type === "free-board" ? b.props : null;
    }
    const item = boards.current.get(board)?.layout.find((i) => i.uid === uid);
    if (item) return item.type === "free-board" ? item.props : null;
    try {
      const v = JSON.parse(fallback ?? "null") as { props?: unknown } | null;
      return v?.props && typeof v.props === "object" && !Array.isArray(v.props) ? (v.props as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  /** Une image ou une vidéo posée dans la planche libre, son centre en (x, y) % de la zone. */
  const freePut = async (uid: string, board: number | undefined, x: number, y: number, mediaId: number, hint?: string, fallback?: string): Promise<boolean> => {
    if (blockedRef.current) return false;
    if (board) await itemFlushRef.current();
    const base = freeBase(uid, board, fallback);
    if (!base) {
      toast("Cette planche libre n'existe plus : recharge l'éditeur.", "error");
      return false;
    }
    const kind = mediaKindOf(mediaId, hint);
    if (kind === "pdf") {
      toast("Un PDF se pose dans un bloc « CV ».", "error");
      return false;
    }
    const row = context.media.find((m) => m.id === mediaId);
    const ratio = row?.width && row?.height ? row.width / row.height : kind === "video" ? 16 / 9 : 1.5;
    const res = applyFreeOp(base, { op: "put", id: newFreeId(), media: mediaId, x, y, ratio });
    if ("error" in res) {
      toast(res.error, "error");
      return false;
    }
    const ok = await gridWrite(uid, board, res.props);
    if (ok) toast(kind === "video" ? "Vidéo posée" : "Image posée", "success", { label: "Défaire", run: () => void undoRef.current() });
    return ok;
  };
  /** Choix du média pour « Remplacer » (id donné) ou « + Image » (à la suite, vers le centre). */
  const freeChoose = async (p: NonNullable<typeof freePick>, mediaId: number, hint?: string): Promise<boolean> => {
    const base = freeBase(p.uid, p.board, p.props);
    if (!base) return false;
    // Image d'attente d'une vidéo (lot 116) : une image de la médiathèque, écrite sur la ligne de la vidéo.
    if (p.poster && p.id) {
      if (blockedRef.current) return false;
      if (p.board) await itemFlushRef.current();
      if (mediaKindOf(mediaId, hint) !== "image") {
        toast("L'affiche d'une vidéo est une image.", "error");
        return false;
      }
      const res = applyFreeOp(base, { op: "poster", id: p.id, media: mediaId });
      if ("error" in res) {
        toast(res.error, "error");
        return false;
      }
      return gridWrite(p.uid, p.board, res.props);
    }
    if (!p.id) {
      const n = Array.isArray(base.items) ? base.items.length : 0;
      return freePut(p.uid, p.board, n === 0 ? 50 : 35 + ((n * 13) % 40), n === 0 ? 50 : 40 + ((n * 17) % 25), mediaId, hint, p.props);
    }
    if (blockedRef.current) return false;
    if (p.board) await itemFlushRef.current();
    if (mediaKindOf(mediaId, hint) === "pdf") {
      toast("Un PDF se pose dans un bloc « CV ».", "error");
      return false;
    }
    const res = applyFreeOp(base, { op: "replace", id: p.id, media: mediaId });
    if ("error" in res) {
      toast(res.error, "error");
      return false;
    }
    return gridWrite(p.uid, p.board, res.props);
  };
  const freeOp = async (msg: Extract<FromCanvas, { kind: "free-op" }>): Promise<boolean> => {
    if (blockedRef.current) return false;
    if (msg.board) await itemFlushRef.current();
    const base = freeBase(msg.uid, msg.board, msg.props);
    if (!base) {
      toast("Cette planche libre n'existe plus : recharge l'éditeur.", "error");
      return false;
    }
    const op = msg.op;
    if (op.op === "pick") {
      setFreePick({ uid: msg.uid, ...(msg.board ? { board: msg.board, ...(msg.props ? { props: msg.props } : {}) } : {}), ...(op.id ? { id: op.id } : {}), ...(op.poster ? { poster: true } : {}) });
      return true;
    }
    const res = applyFreeOp(base, op as FreeModelOp);
    if ("error" in res) {
      toast(res.error, "error");
      return false;
    }
    if (JSON.stringify(res.props) === JSON.stringify(base)) return false;
    const ok = await gridWrite(msg.uid, msg.board, res.props);
    if (ok && op.op === "remove") toast("Image retirée de la planche libre", "success", { label: "Défaire", run: () => void undoRef.current() });
    return ok;
  };

  /**
   * Lecture d'une vidéo depuis sa barre sur la toile (lot 36) : composant Vidéo d'une page, ou composant Vidéo / bande de la
   * planche d'un projet (une bande sans choix, `mode` null, suit la nature de chaque vidéo). Une case de grille passe par `grid-op`.
   */
  const videoMode = async (msg: Extract<FromCanvas, { kind: "video-mode" }>): Promise<boolean> => {
    if (blockedRef.current) return false;
    if (!msg.board) {
      if (!msg.mode || !findBlock(draftRef.current.blocks, msg.uid)) return false;
      setProp(msg.uid, "mode", msg.mode);
      return true;
    }
    await itemFlushRef.current();
    const item = boards.current.get(msg.board)?.layout.find((i) => i.uid === msg.uid);
    let base: Record<string, unknown> | null = item?.props ?? null;
    const type = item?.type ?? msg.item;
    if (!base) {
      try {
        const v = JSON.parse(msg.props ?? "null") as { props?: unknown } | null;
        base = v?.props && typeof v.props === "object" && !Array.isArray(v.props) ? (v.props as Record<string, unknown>) : null;
      } catch {
        base = null;
      }
    }
    if (!base || (type !== "strip" && type !== "video-single")) return false;
    const key = type === "strip" ? "videoMode" : "mode";
    const next = { ...base };
    if (msg.mode) next[key] = msg.mode;
    else delete next[key];
    return Boolean(await boardDo(msg.board, { op: "item-set", uid: msg.uid, props: next }));
  };

  /** Mise en forme (cadre, recadrage) de la case d'une grille de planche. */
  const cellLook = async (msg: Extract<FromCanvas, { kind: "cell-look" }>): Promise<boolean> => {
    if (blockedRef.current) return false;
    await itemFlushRef.current();
    const base = gridBase(msg.grid, msg.board, msg.props);
    const kids = gridKids(base);
    const i = kids.findIndex((k) => k.uid === msg.uid);
    if (!base || i < 0) return false;
    const clean = msg.look ? cleanLook(msg.look) : undefined;
    const children = kids.map((k, j) => {
      if (j !== i) return k;
      const { look: _old, ...rest } = k.props;
      void _old;
      return { ...k, props: clean ? { ...rest, look: clean } : rest };
    });
    return gridWrite(msg.grid, msg.board, { ...base, children });
  };

  /**
   * UNE écriture pour l'habillage d'un média (lot 75, R4) : cadre, fond derrière l'image, arrondi, panorama, lecture. Le même réducteur
   * (src/lib/edit/media-look.ts) pour une rubrique ou une case de la page, une place de carrousel, un composant ou une case de planche
   * et une image de la Planche libre ; une action = un pas d'historique. false = refusé ou sans effet.
   */
  const mediaLook = async (msg: Extract<FromCanvas, { kind: "media-look" }>): Promise<boolean> => {
    if (blockedRef.current) return false;
    const t = msg.target;
    const patch = msg.patch;
    const refuse = (error: string) => {
      toast(error, "error");
      return false;
    };
    switch (t.kind) {
      case "block":
      case "slot": {
        const block = findBlock(draftRef.current.blocks, t.uid);
        if (!block) return false;
        const res = applyMediaPatch(readLook(block.props.look), patch, t.kind === "slot" ? t.slug : undefined);
        if ("error" in res) return refuse(res.error);
        if (JSON.stringify(readLook(block.props.look) ?? null) === JSON.stringify(res.look ?? null)) return false;
        await applyLook(t.uid, res.look ?? null);
        return true;
      }
      case "item":
        handlers.current.itemMediaLook(t.board, t.uid, patch);
        return true;
      case "cell": {
        await itemFlushRef.current();
        const base = gridBase(t.grid, t.board, t.props);
        const kid = gridKids(base).find((k) => k.uid === t.uid);
        if (!base || !kid) return false;
        const res = applyMediaPatch(readLook(kid.props.look), patch);
        if ("error" in res) return refuse(res.error);
        if (JSON.stringify(readLook(kid.props.look) ?? null) === JSON.stringify(res.look ?? null)) return false;
        return cellLook({ kind: "cell-look", board: t.board, grid: t.grid, ...(t.props ? { props: t.props } : {}), uid: t.uid, look: res.look ?? null });
      }
      case "free": {
        if (t.board) await itemFlushRef.current();
        const base = freeBase(t.uid, t.board, t.props);
        if (!base) return refuse("Cette planche libre n'existe plus : recharge l'éditeur.");
        const res = applyFreeLook(base, t.id, patch);
        if ("error" in res) return refuse(res.error);
        if (JSON.stringify(res.props) === JSON.stringify(base)) return false;
        return gridWrite(t.uid, t.board, res.props);
      }
    }
  };

  /** Fond d'une rubrique de premier niveau, depuis la toile (lot 17c) ; false = refusé ou sans effet. */
  const applySurface = (uid: string, next: Surface | null, continuous = false): boolean => {
    const list = draftRef.current.blocks;
    const at = locate(list, uid);
    const block = findBlock(list, uid);
    if (!at || at.parent !== null || !block) return false;
    const clean = next ? cleanSurface(next) : null;
    if (JSON.stringify(readSurface(block.props.surface) ?? null) === JSON.stringify(clean)) return false;
    setBlocks(
      updateBlock(list, uid, (b) => {
        const props = { ...b.props };
        if (clean) props.surface = clean;
        else delete props.surface;
        return { ...b, props };
      }),
      // Un clic = un pas d'historique ; seuls les glissements continus (roue, curseur) se fusionnent.
      continuous ? { key: `surface:${uid}` } : {},
    );
    return true;
  };

  /** Fond de couleur d'un composant (lot 32), de la page ou d'un conteneur ; false = refusé ou sans effet. */
  const applyBackground = (uid: string, next: Background | null, continuous = false): boolean => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, uid);
    if (!block || !supportsFond(block.type)) return false;
    if (JSON.stringify(readBackground(block.props.background) ?? null) === JSON.stringify(next)) return false;
    setBlocks(
      updateBlock(list, uid, (b) => {
        const props = { ...b.props };
        if (next) props.background = next;
        else delete props.background;
        return { ...b, props };
      }),
      continuous ? { key: `background:${uid}` } : {},
    );
    return true;
  };

  /**
   * Fond unique (lot 66) : carte ET fond d'un bloc écrits ensemble (un seul pas d'historique). La carte n'existe qu'au premier niveau, le
   * fond que sur les grands composants : une couche que le bloc ne sait pas porter refuse tout. false = refusé ou sans effet.
   */
  const applyFond = (uid: string, nextSurface: Surface | null, nextBackground: Background | null, continuous = false): boolean => {
    const list = draftRef.current.blocks;
    const at = locate(list, uid);
    const block = findBlock(list, uid);
    if (!at || !block) return false;
    if (nextSurface && at.parent !== null) return false;
    if (nextBackground && !supportsFond(block.type)) return false;
    const cleanS = nextSurface ? cleanSurface(nextSurface) : null;
    const sameS = JSON.stringify(readSurface(block.props.surface) ?? null) === JSON.stringify(cleanS);
    const sameB = JSON.stringify(readBackground(block.props.background) ?? null) === JSON.stringify(nextBackground);
    if (sameS && sameB) return false;
    setBlocks(
      updateBlock(list, uid, (b) => {
        const props = { ...b.props };
        if (cleanS) props.surface = cleanS;
        else delete props.surface;
        if (nextBackground) props.background = nextBackground;
        else delete props.background;
        return { ...b, props };
      }),
      continuous ? { key: `fond:${uid}` } : {},
    );
    return true;
  };

  const op = (kind: "up" | "down" | "duplicate" | "delete" | "out" | "in", uid: string) => {
    const list = draftRef.current.blocks;
    const at = locate(list, uid);
    if (!at) return;
    const siblings = listOf(list, at.parent) ?? [];
    const i = at.index;
    const move = (parent: string | null, index: number, done?: string) => {
      const next = moveBlock(list, uid, parent, index);
      if (!next) {
        toast("Ce bloc ne peut pas aller là.", "error");
        return;
      }
      setBlocks(next);
      if (done) toast(done);
    };
    // Bloc verrouillé (lot 89, « Sortie ») : ni supprimé ni dupliqué ; on dit pourquoi au lieu de ne rien faire.
    const locked = own(byType, at ? (siblings[at.index]?.type ?? "") : "")?.locked;
    if (locked && (kind === "delete" || kind === "duplicate")) {
      toast(kind === "delete" ? locked : "Ce bloc existe une seule fois sur la page : tu peux le déplacer et le mettre en forme, pas le dupliquer.", "error");
      return;
    }
    if (kind === "delete") {
      setDeletingLost(overlayLost(uid));
      setDeleting(uid);
      return;
    }
    if (kind === "up" && i > 0) move(at.parent, i - 1);
    if (kind === "down" && i < siblings.length - 1) move(at.parent, i + 2);
    if (kind === "out" && at.parent) {
      // Sortir : juste après son conteneur, dans la liste du conteneur.
      const outer = locate(list, at.parent)!;
      move(outer.parent, outer.index + 1, "Sorti du bloc");
    }
    if (kind === "in") {
      // Entrer dans le conteneur voisin (après, sinon avant) qui l'accepte.
      const block = siblings[i];
      const next = siblings[i + 1];
      const prev = siblings[i - 1];
      const target = [next, prev].find((c) => c && isContainer(c.type) && canPlace(removeBlock(list, uid), block, c.uid));
      if (!target) {
        toast("Aucun bloc voisin n'accepte ce bloc.", "error");
        return;
      }
      const index = target === next ? 0 : (listOf(list, target.uid)?.length ?? 0);
      move(target.uid, index, `Placé dans « ${own(byType, target.type)?.label ?? "le bloc"} »`);
    }
    if (kind === "duplicate") {
      if (at.parent === null && list.length >= 40) {
        toast("40 blocs au plus par page.", "error");
        return;
      }
      const copy = withFreshUids(clone(siblings[i]), newUid);
      const next = insertBlock(list, copy, at.parent, i + 1);
      if (!next) {
        toast("Ce bloc est plein.", "error");
        return;
      }
      setBlocks(next);
      selectBlock(copy.uid);
    }
  };

  /** Planches (avec surcouche d'images) que la suppression d'un bloc retirerait de la page. */
  const overlayLost = (uid: string): string[] => {
    const list = draftRef.current.blocks;
    const after = new Set(boardRefs(removeBlock(list, uid)).map((b) => b.slug));
    return [...new Set(boardRefs(list).map((b) => b.slug))].filter((s) => !after.has(s) && overlaySlugs.current.has(s));
  };

  const remove = (uid: string) => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, uid);
    setDeleting(null);
    if (!block) return;
    const lost = overlayLost(uid);
    const at = locate(list, uid);
    setBlocks(removeBlock(list, uid));
    if (selected === uid) selectBlock(at?.parent ?? null);
    if (lost.length) {
      // La surcouche d'une planche n'est appliquée que si la page l'affiche.
      toast(`Bloc supprimé · Les changements d'images de ${lost.length > 1 ? "ces projets" : "ce projet"} ne seront pas publiés`, "success", { label: "Défaire", run: () => void undoRef.current() });
    } else toast(`Bloc supprimé · Défaire (Ctrl+Z) pour la récupérer`, "success", { label: "Défaire", run: () => void undoRef.current() });
  };

  /** Texte posé en place ; false = refusé (la toile retire son aperçu et rétablit le texte d'origine). */
  const editText = (uid: string, path: string, textLocale: string, value: string): boolean => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, uid);
    const def = block && own(byType, block.type);
    // Lot 105 : texte d'une entrée des collections en mode automatique (`tile.<page>.<champ>`) : écrit dans les modifications de tuile, attaché à la page.
    const tilePath = block?.type === "collection-tiles" && tilesMode(block.props) === "auto" ? /^tile\.(\d{1,9})\.(eyebrow|title|intro)$/.exec(path) : null;
    if (block && tilePath && (textLocale === "fr" || textLocale === "en")) {
      const pageId = Number(tilePath[1]);
      const field = tilePath[2] as "eyebrow" | "title" | "intro";
      const page = (context.collectionPages ?? []).find((p) => p.pageId === pageId);
      if (!page) return false;
      const edits = [...((block.props.edits as TileEdit[] | undefined) ?? [])];
      const at = edits.findIndex((e) => e.pageId === pageId);
      const current: TileEdit = at >= 0 ? edits[at] : { pageId };
      const base = current[field] ?? page[field];
      const next = { ...base, [textLocale]: value.slice(0, 2000) };
      const merged: TileEdit = { ...current, [field]: next };
      if (sameL(next, page[field])) delete merged[field];
      if (at >= 0) edits.splice(at, 1);
      if (Object.keys(merged).length > 1) edits.push(merged);
      const props = { ...block.props } as Record<string, unknown>;
      if (edits.length) props.edits = edits;
      else delete props.edits;
      const blockedTile = Boolean(blockedRef.current);
      setBlocks(updateBlock(list, uid, (b) => ({ ...b, props })), { structural: true });
      return !blockedTile;
    }
    if (!block || !def || !inlineAllowed(def.inline, path) || (textLocale !== "fr" && textLocale !== "en")) return false;
    // Accroche de l'ouverture : seul le balisage <mark>…</mark> bien formé entre dans le brouillon.
    const problem = block.type === "hero" && path === "statement" ? markedProblem(value) : null;
    if (problem) {
      toast(problem, "error");
      return false;
    }
    const props = setLocalizedAt(block.props, path, textLocale, value.slice(0, 2000));
    // Éditeur arrêté (page modifiée ailleurs) : `apply` avertit et n'écrit rien, la toile retire son aperçu.
    const blocked = Boolean(blockedRef.current);
    setBlocks(
      updateBlock(list, uid, (b) => ({ ...b, props })),
      { structural: true },
    );
    return !blocked;
  };

  /** Déplacement depuis la toile ou la structure : dans la page, dans un conteneur, entre les deux. */
  const moveTree = (uid: string, parent: string | null, index: number) => {
    const list = draftRef.current.blocks;
    if (parent === null && locate(list, uid)?.parent !== null && list.length >= 40) return toast("40 blocs au plus par page.", "error");
    const next = moveBlock(list, uid, parent, index);
    if (!next) return toast(parent ? "Ce bloc n'accepte pas ce type de bloc (ou il est plein)." : "Déplacement impossible.", "error");
    if (next !== list) setBlocks(next);
  };

  /** Champs d'un formulaire de contact retirés, déplacés ou ajoutés depuis la toile. */
  /** Champ ajouté, retiré ou déplacé depuis la toile ; false = refusé (la toile retire son aperçu). */
  const formField = (msg: Extract<FromCanvasMsg, { kind: "form-field" }>): boolean => {
    const refuse = (message: string) => {
      toast(message, "error");
      return false;
    };
    const block = findBlock(draftRef.current.blocks, msg.uid);
    if (!block || !isFormBlock(block.type, block.props)) return false;
    const fields = ((block.props.fields as FormField[] | undefined) ?? []).slice();
    if (msg.op === "add") {
      if (fields.length >= MAX_FIELDS) return refuse(`${MAX_FIELDS} champs au plus.`);
      const field = makeField(msg.fieldType ?? "text");
      // Identifiant choisi par la toile (son aperçu et le champ réel se reconnaissent), s'il est libre.
      if (msg.id && !fields.some((f) => f.id === msg.id)) field.id = msg.id;
      if (field.type === "email" && !fields.some((f) => f.reply)) field.reply = true;
      setProp(msg.uid, "fields", [...fields, field]);
      toast("Champ ajouté · double-clic sur son libellé pour le renommer");
      return true;
    }
    const i = msg.index ?? -1;
    if (!fields[i]) return false;
    if (msg.op === "help-add" || msg.op === "help-remove") {
      // Aide d'un champ : absente = aucune place (ni texte fantôme, ni rien en public) ; ajoutée = emplacement à remplir sur la toile.
      const next = { ...fields[i] };
      if (msg.op === "help-add") next.help = { fr: "", en: "" };
      else delete next.help;
      setProp(msg.uid, "fields", fields.map((f, j) => (j === i ? next : f)));
      return true;
    }
    if (msg.op === "remove") {
      if (fields.length <= 1) return refuse("Un formulaire garde au moins un champ.");
      if (fields[i].reply) return refuse("Ce champ e-mail sert à te répondre : dans le panneau, désactive « Sert à te répondre » (ou choisis un autre champ) avant de le retirer.");
      setProp(msg.uid, "fields", fields.filter((_, j) => j !== i));
      toast("Champ retiré", "success", { label: "Défaire", run: () => void undoRef.current() });
      return true;
    }
    const to = msg.to ?? i;
    if (to < 0 || to >= fields.length || to === i) return false;
    const [x] = fields.splice(i, 1);
    fields.splice(to, 0, x);
    setProp(msg.uid, "fields", fields);
    return true;
  };

  /** Réglage d'un bloc (où qu'il soit) : agencement d'une grille, média… */
  const setProp = (uid: string, key: string, value: unknown) => {
    const list = draftRef.current.blocks;
    if (!findBlock(list, uid)) return;
    setBlocks(updateBlock(list, uid, (b) => {
      const props = { ...b.props };
      if (value === undefined) delete props[key];
      else props[key] = value;
      return { ...b, props };
    }));
  };

  /* ---- Mise en page (lot 2) : réglages des blocs, styles du site, polices --- */

  const fontLib = useRef<FontLibrary>(lookContext.fonts);
  const [fontFamilies, setFontFamilies] = useState<string[]>(() => Object.keys(lookContext.fonts));
  const [fontBusy, setFontBusy] = useState<string | null>(null);

  /**
   * Polices Google citées par des styles : le serveur télécharge chaque style
   * (graisse × italique) qui manque. Un échec : message, rien n'est appliqué.
   */
  const ensureFonts = useCallback(async (styles: (TextStyle | undefined)[]): Promise<boolean> => {
    for (const s of styles) {
      const family = googleOf(s?.font);
      const g = family ? googleFamily(family) : undefined;
      if (!g) continue;
      const italic = Boolean(s?.italic) && g.italics.length > 0;
      const weight = nearestWeight(g, s?.weight ?? 400, italic);
      if (hasFace(fontLib.current, g.family, weight, italic)) continue;
      setFontBusy(g.family);
      toast(`Téléchargement de « ${g.family} » par le site…`);
      let result: Awaited<ReturnType<typeof installFontAction>>;
      try {
        result = await installFontAction(g.family, weight, italic);
      } catch {
        result = { ok: false, message: `Impossible de télécharger « ${g.family} » (connexion perdue). La police n'est pas appliquée.` };
      } finally {
        setFontBusy(null);
      }
      if (!result.ok) {
        toast(result.message, "error");
        return false;
      }
      fontLib.current = result.data.library;
      setFontFamilies(Object.keys(result.data.library));
    }
    return true;
  }, []);

  /** Réglages d'un bloc venus de la toile ou du panneau (null : tout revient au thème). */
  const applyLook = async (uid: string, next: Look | null): Promise<boolean> => {
    const clean = next ? cleanLook(next) : undefined;
    working.current++;
    try {
      if (!(await ensureFonts([...Object.values(clean?.text ?? {}), ...Object.values(clean?.projectText ?? {})]))) {
        send({ kind: "refresh", rev: revRef.current, upTo: -1 });
        return false;
      }
      const list = draftRef.current.blocks;
      const block = findBlock(list, uid);
      // Bloc inconnu de l'éditeur (la toile et l'éditeur ne nomment plus les blocs pareil) : refusé, la toile retire son aperçu (lot 115).
      if (!block) return false;
      if (JSON.stringify(readLook(block.props.look) ?? null) === JSON.stringify(clean ?? null)) return true;
      const before = draftRef.current;
      setBlocks(
        updateBlock(list, uid, (b) => {
          const props = { ...b.props };
          if (clean) props.look = clean;
          else delete props.look;
          return { ...b, props };
        }),
        { key: `look:${uid}` },
      );
      // Page bloquée (modifiée ailleurs, brouillon illisible) : rien n'est écrit, l'aperçu de la toile ne doit pas rester affiché.
      return draftRef.current !== before;
    } finally {
      working.current--;
      settleIfQuiet();
    }
  };

  /** Styles du site (brouillon du site : toutes les pages à la publication). */
  const applySiteStyles = async (update: (cur: SiteStyles | undefined) => SiteStyles | undefined, fonts: (TextStyle | undefined)[]) => {
    working.current++;
    try {
      if (!(await ensureFonts(fonts))) {
        send({ kind: "refresh", rev: revRef.current, upTo: -1 });
        return;
      }
      // Calculé dans le verrou, sur le dernier état écrit : deux réglages rapprochés se cumulent.
      await writeSite((cur) => {
        const clean = cleanSiteStyles(update(cur.styles));
        const { styles: _old, ...rest } = cur;
        void _old;
        return { ...rest, ...(clean ? { styles: clean } : {}) };
      });
    } finally {
      working.current--;
      settleIfQuiet();
    }
  };
  const applySiteStyle = (role: Role, style: TextStyle | null) =>
    void applySiteStyles((cur) => {
      const current = cur ?? {};
      const roles = { ...(current.roles ?? {}) };
      if (style) roles[role] = style;
      else delete roles[role];
      return { ...current, roles };
    }, [style ?? undefined]);

  /** Lot 124 : réglage d'UN texte de l'en-tête ou du pied de page (`styles.texts`), et d'une zone (`styles.zones`) : mêmes écriture et même historique que les styles de rôle. */
  const applySiteTextStyle = (key: string, style: TextStyle | null) =>
    void applySiteStyles((cur) => {
      const current = cur ?? {};
      const texts = { ...(current.texts ?? {}) };
      if (style) texts[key] = style;
      else delete texts[key];
      return { ...current, texts };
    }, [style ?? undefined]);
  const applySiteZoneStyle = (zone: HzZone, style: TextStyle | null) =>
    void applySiteStyles((cur) => {
      const current = cur ?? {};
      const zones = { ...(current.zones ?? {}) };
      if (style) zones[zone] = style;
      else delete zones[zone];
      return { ...current, zones };
    }, [style ?? undefined]);

  /* ---- Palette et logo du site (lot 17f) ----------------------------------
     L'aperçu est immédiat (la toile le pose et renvoie l'intention `site-look`) ; l'écriture est
     regroupée (350 ms sans nouveau geste) : un glisser sur la roue ou le curseur = un seul pas
     d'historique. Tant qu'un réglage attend, rien n'est acquitté (`working`). */
  const [pendingLook, setPendingLook] = useState<{ palette: SitePalette; logo: Logo } | null>(null);
  const [hlInfo, setHlInfo] = useState<HighlightInfo | null>(null);
  const lookQueued = useRef<{ palette: SitePalette; logo: Logo; seq?: number } | null>(null);
  const lookTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitLook = useCallback(async () => {
    clearTimeout(lookTimer.current);
    const q = lookQueued.current;
    if (!q) return;
    lookQueued.current = null;
    try {
      let unchanged = false;
      const ok = await writeSite((cur) => {
        const { styles: old, ...rest } = cur;
        const clean = cleanSiteStyles({ ...(old ?? {}), palette: q.palette, logo: q.logo });
        unchanged = JSON.stringify(clean ?? null) === JSON.stringify(old ?? null);
        return unchanged ? null : { ...rest, ...(clean ? { styles: clean } : {}) };
      });
      // Refusé (planche tenue ailleurs, connexion perdue…) : la toile retire son aperçu. Inchangé : rien à écrire, elle le lâche.
      if (!ok && !unchanged && q.seq) send({ kind: "revert", seq: q.seq });
    } finally {
      working.current--;
      if (!lookQueued.current) setPendingLook(null);
      settleIfQuiet();
    }
  }, [send, settleIfQuiet, writeSite]);
  useEffect(() => {
    commitLookRef.current = commitLook;
  }, [commitLook]);
  const queueLook = useCallback(
    (palette: SitePalette, logo: Logo, seq?: number) => {
      if (!lookQueued.current) working.current++;
      lookQueued.current = { palette, logo, seq };
      setPendingLook({ palette, logo });
      clearTimeout(lookTimer.current);
      lookTimer.current = setTimeout(() => void commitLook(), 350);
    },
    [commitLook],
  );
  useEffect(() => () => clearTimeout(lookTimer.current), []);
  /** Depuis le panneau : montré sur la toile (qui renvoie l'intention), ou directement si la toile n'est pas prête. */
  const lookEchoed = useRef(0);
  /** Image du logo (lot 26) : choix dans la médiathèque ou envoi d'un fichier, depuis le panneau « Logo ». */
  const [logoPick, setLogoPick] = useState(false);
  const requestLook = (palette: SitePalette, logo: Logo) => {
    setPendingLook({ palette, logo });
    if (frameReady && mode === "edit") {
      const before = lookEchoed.current;
      send({ kind: "site-look", palette, logo });
      // Calque de la toile pas encore monté (chargement, changement de mode) : sans écho, on enregistre directement.
      setTimeout(() => {
        if (lookEchoed.current === before) queueLook(palette, logo);
      }, 800);
    } else queueLook(palette, logo);
  };
  const highlightRole = useCallback(
    (role: HighlightInfo["role"]) => {
      if (!role) setHlInfo(null);
      send({ kind: "highlight", role });
    },
    [send],
  );

  /* ---- Messages de la toile ---------------------------------------------- */

  /* ---- Planches sur la toile : projets, dépôts, fantômes ----------------- */

  const [extraProjects, setExtraProjects] = useState<{ id: number; slug: string; title: string; draft: true }[]>([]);
  const projectsList = useMemo(() => {
    const seen = new Set(context.projects.map((p) => p.slug));
    return [...context.projects, ...extraProjects.filter((p) => !seen.has(p.slug))];
  }, [context.projects, extraProjects]);
  // `createProject` du panneau : branché plus bas (createProjectForPanel), une fois défini.
  const panelCreate = useRef<(name: string) => Promise<string | null>>(async () => null);
  const editorContext = useMemo(
    () => ({
      ...context,
      projects: projectsList,
      createProject: (name: string) => panelCreate.current(name),
      previewForm: (pane: "form" | "success" | "error") => {
        if (selected) send({ kind: "form-preview", uid: selected, pane });
      },
    }),
    [context, projectsList, selected, send],
  );

  const ghostsRef = useRef<GhostItem[]>([]);
  const [ghosts, setGhosts] = useState<GhostItem[]>([]);
  const setGhostList = useCallback((fn: (list: GhostItem[]) => GhostItem[]) => {
    const before = ghostsRef.current;
    ghostsRef.current = fn(before);
    // Aperçus des fantômes retirés : URL blob: libérées.
    for (const g of before) if (g.preview && !ghostsRef.current.some((x) => x.preview === g.preview)) URL.revokeObjectURL(g.preview);
    setGhosts(ghostsRef.current);
  }, []);
  const patchGhost = useCallback((id: string, patch: Partial<GhostItem>) => setGhostList((list) => list.map((g) => (g.id === id ? { ...g, ...patch } : g))), [setGhostList]);
  useEffect(() => {
    send({ kind: "ghosts", items: ghosts.map(toWire) });
  }, [ghosts, send]);
  const [picker, setPicker] = useState<{ board: number; key: string } | null>(null);
  /** Ajout d'images proposé à la création d'un projet (lot 111). */
  const [addPicker, setAddPicker] = useState<{ board: number } | null>(null);
  const dropTargetRef = useRef<DropTargetInfo | null>(null);

  /** Bloc « Planche d'un projet » ou conteneur « Projet mis en avant » : projet choisi ou créé. */
  const setBoardProject = useCallback(
    (uid: string, slug: string) => {
      const list = draftRef.current.blocks;
      const block = findBlock(list, uid);
      if (!block || (block.type !== "project-board" && block.type !== "featured-project")) return;
      apply({ ...draftRef.current, blocks: updateBlock(list, uid, (b) => ({ ...b, props: { ...b.props, project: slug } })) }, { structural: true });
    },
    [apply],
  );

  const createProject = useCallback(
    async (uid: string, name: string, propose = false): Promise<{ id: number; slug: string } | null> => {
      if (blockedRef.current) return null;
      const result = await createDraftProjectAction(pageId, name);
      if (!result.ok) {
        toast(result.message, "error");
        return null;
      }
      setExtraProjects((list) => [...list, { id: result.data.id, slug: result.data.slug, title: result.data.title, draft: true }]);
      if (uid) setBoardProject(uid, result.data.slug);
      toast(`Projet « ${result.data.title} » créé : il devient public avec la page`);
      // Lot 111 : un projet créé sans nom propose tout de suite d'y ajouter des images.
      if (propose) setAddPicker({ board: result.data.id });
      return { id: result.data.id, slug: result.data.slug };
    },
    [pageId, setBoardProject],
  );
  useEffect(() => {
    panelCreate.current = async (name) => (await createProject("", name, true))?.slug ?? null;
  }, [createProject]);

  /* ---- Médias des blocs (image, vidéo, fond de l'ouverture, portrait) ---- */

  const mediaKindOf = (mediaId: number, fallback?: string): string | undefined => context.media.find((m) => m.id === mediaId)?.kind ?? fallback;

  /**
   * Un média posé sur un bloc (champ déclaré `mediaFields` au registre, type
   * de média contrôlé), ou dans la place libre d'une grille (un composant
   * Vidéo ou Image y est créé).
   */
  const placeMedia = (target: Extract<DropTargetInfo, { kind: "media" | "cell" }>, mediaId: number, kindHint?: string) => {
    const list = draftRef.current.blocks;
    const kind = mediaKindOf(mediaId, kindHint);
    const block = findBlock(list, target.uid);
    if (!block) return;
    if (target.kind === "cell") {
      if (kind === "pdf") return toast("Un PDF se pose dans un bloc « CV ».", "error");
      const type = kind === "video" ? "video-single" : "image";
      const child = { uid: newUid(), type, props: type === "video-single" ? { variant: "card", mode: "player", mediaId } : { width: "wide", mediaId } } as DraftBlock;
      const next = insertBlock(list, child, target.uid, listOf(list, target.uid)?.length ?? 0);
      if (!next) return toast("Cette grille n'accepte plus de bloc.", "error");
      setBlocks(next);
      selectBlock(child.uid);
      return;
    }
    const field = own(byType, block.type)?.mediaFields?.find((f) => f.field === target.field);
    if (!field) return;
    const expected = { video: "Ce bloc attend une vidéo.", pdf: "Ce bloc attend un PDF.", image: "Ce bloc attend une image.", any: "Ce bloc attend une image ou une vidéo." }[field.kind];
    if (kind && (field.kind === "any" ? kind === "pdf" : kind !== field.kind)) return toast(expected, "error");
    setProp(target.uid, target.field, mediaId);
    toast(field.kind === "video" ? "Vidéo placée" : field.kind === "pdf" ? "PDF placé" : "Image placée", "success", { label: "Défaire", run: () => void undoRef.current() });
  };

  /** Envoie un fichier et attend sa conversion : l'identifiant du média prêt, ou null (le message d'erreur est affiché). */
  const sendAndWait = async (file: File): Promise<number | null> => {
    toast(`Envoi de « ${file.name.slice(0, 60)} »…`);
    const up = await sendFile(file, () => undefined);
    if (!up.ok) {
      toast(up.message, "error");
      return null;
    }
    router.refresh();
    let ready = false;
    for (let i = 0; i < 1300; i++) {
      const st = await mediaStatusAction([up.media.id]);
      const row = st.ok ? st.data[0] : undefined;
      if (row?.status === "ready") {
        ready = true;
        break;
      }
      if (!row || row.status === "failed") break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!ready) {
      toast(`« ${file.name.slice(0, 60)} » : conversion impossible.`, "error");
      return null;
    }
    return up.media.id;
  };

  /** Fichiers déposés sur un bloc média ou une place libre : envoyés, convertis, puis posés. */
  const uploadToBlock = async (target: Extract<DropTargetInfo, { kind: "media" | "cell" }>, files: File[]) => {
    for (const file of target.kind === "media" ? files.slice(0, 1) : files) {
      const id = await sendAndWait(file);
      if (id === null) continue;
      placeMedia(target, id, file.type.startsWith("video/") ? "video" : isPdfFile(file) ? "pdf" : "image");
    }
  };

  const [mediaPick, setMediaPick] = useState<{ uid: string; field: "mediaId" | "backgroundMediaId" | "portraitMediaId"; kind: "image" | "video" | "pdf" | "any" } | null>(null);
  const mediaOp = (uid: string, field: "mediaId" | "backgroundMediaId" | "portraitMediaId", what: "replace" | "clear") => {
    const block = findBlock(draftRef.current.blocks, uid);
    const decl = block && own(byType, block.type)?.mediaFields?.find((f) => f.field === field);
    if (!decl) return;
    if (what === "clear") {
      setProp(uid, field, undefined);
      toast(field === "backgroundMediaId" ? "Fond du thème rétabli" : "Média retiré", "success", { label: "Défaire", run: () => void undoRef.current() });
    } else setMediaPick({ uid, field, kind: decl.kind });
  };

  /** Envoie un fichier fantôme, attend sa conversion, puis crée l'emplacement à sa position. */
  const processGhost = useCallback(
    async (id: string): Promise<boolean> => {
      let g = ghostsRef.current.find((x) => x.id === id);
      if (!g) return false;
      let mediaId = g.mediaId;
      if (mediaId === undefined) {
        if (!g.file) return false;
        patchGhost(id, { phase: "upload", progress: 0, message: undefined });
        const up = await sendFile(g.file, (sent, total) => patchGhost(id, { progress: total ? sent / total : 0 }));
        if (!up.ok) {
          patchGhost(id, { phase: "failed", progress: null, message: up.message });
          return false;
        }
        mediaId = up.media.id;
        patchGhost(id, { mediaId, phase: "convert", progress: null });
        // Médiathèque du panneau à jour sans rechargement.
        router.refresh();
      }
      // Conversion : l'emplacement n'est créé qu'avec un média prêt (15 min au plus).
      let ready = false;
      for (let i = 0; i < 1300; i++) {
        const st = await mediaStatusAction([mediaId]);
        const row = st.ok ? st.data[0] : undefined;
        if (row?.status === "ready") {
          ready = true;
          break;
        }
        if (!row || row.status === "failed") {
          patchGhost(id, { phase: "failed", progress: null, message: row?.error ?? "conversion impossible" });
          return false;
        }
        if (row.progress !== null) patchGhost(id, { progress: row.progress / 100 });
        await new Promise((r) => setTimeout(r, 700));
      }
      if (!ready) {
        patchGhost(id, { phase: "failed", progress: null, message: "conversion trop longue" });
        return false;
      }
      g = ghostsRef.current.find((x) => x.id === id);
      if (!g) return false;
      const op: BoardOp = g.slot
        ? slotBoardOp(g.slot, { op: "fill", mediaId })
        : g.rail
          ? { op: "rail-add", uid: g.rail, mediaId, index: g.index ?? 0 }
          : { op: "add", mediaId, index: g.index ?? 0, ...(g.collection ? { collection: g.collection } : {}) };
      const result = await boardDo(g.board, op);
      if (!result) {
        patchGhost(id, { phase: "failed", progress: null, message: "placement refusé" });
        return false;
      }
      const placed = g.slot ?? (g.rail ? railKey(g.rail, g.index ?? 0) : result.after.slots[g.index ?? 0]?.key);
      patchGhost(id, { phase: "done", progress: 1, key: placed });
      // Les fantômes suivants du même dépôt se placent juste après.
      if (!g.slot) setGhostList((list) => list.map((x) => (x.batch === g!.batch && x.id !== id && x.phase !== "done" && x.index !== undefined ? { ...x, index: x.index + 1 } : x)));
      setTimeout(() => setGhostList((list) => list.filter((x) => x.id !== id)), 8000);
      return true;
    },
    [boardDo, patchGhost, router, setGhostList],
  );

  /** Fichiers déposés sur la toile : fantômes à la position même, envoyés dans l'ordre. */
  const uploadFiles = useCallback(
    async (target: DropTargetInfo, files: File[]) => {
      if (blockedRef.current) return;
      let board: number;
      let index = 0;
      let slot: string | undefined;
      let rail: string | undefined;
      let collection: "characters" | "backgrounds" | "animation" | undefined;
      if (target.kind === "media" || target.kind === "cell") {
        await uploadToBlock(target, files);
        return;
      }
      // Lot 31d : une case précise d'une grille. Le premier fichier prend cette case, les suivants se rangent à la suite.
      if (target.kind === "gcell") {
        let at = target.index;
        for (const file of files) {
          const id = await sendAndWait(file);
          if (id === null) continue;
          const kind = file.type.startsWith("video/") ? "video" : isPdfFile(file) ? "pdf" : "image";
          if (!(await gridPut(target.uid, target.board, at, id, kind, target.props))) break;
          at = 1000;
        }
        return;
      }
      // Lot 42 : planche libre. Les fichiers sont posés là où on les a lâchés (le premier), puis légèrement décalés.
      if (target.kind === "free") {
        let n = 0;
        for (const file of files) {
          const id = await sendAndWait(file);
          if (id === null) continue;
          const kind = file.type.startsWith("video/") ? "video" : isPdfFile(file) ? "pdf" : "image";
          if (!(await freePut(target.uid, target.board, Math.min(100, target.x + n * 6), Math.min(100, target.y + n * 6), id, kind, target.props))) break;
          n++;
        }
        return;
      }
      // Un composant de la planche (lot 31c) : fichiers envoyés à la médiathèque, convertis, puis posés (Image : remplace ; Grille, carrousel : ajoutent).
      if (target.kind === "bitem") {
        await itemFlushRef.current();
        for (const file of files) {
          const id = await sendAndWait(file);
          if (id === null) continue;
          const r = await boardDo(target.board, { op: "item-media", uid: target.uid, mediaId: id });
          if (!r) break;
          const type = r.after.layout.find((i) => i.uid === target.uid)?.type;
          // Une Image ou une Vidéo ne reçoit qu'un fichier.
          if (type === "image" || type === "video-single") break;
        }
        return;
      }
      if (target.kind === "new") {
        const created = await createProject(target.uid, "Projet sans titre");
        if (!created) return;
        board = created.id;
      } else if (target.kind === "slot") {
        board = target.board;
        slot = target.key;
        files = files.slice(0, 1);
      } else if (target.kind === "rail") {
        board = target.board;
        index = target.index;
        rail = target.uid;
      } else {
        board = target.board;
        index = target.index;
        collection = target.collection;
      }
      const batch = batchId();
      const created: GhostItem[] = [];
      for (const [i, file] of files.entries()) {
        const info = file.type.startsWith("image/") ? await readRatio(file) : null;
        created.push({
          id: `${batch}-${i}`,
          batch,
          board,
          ...(slot ? { slot } : { index }),
          ...(rail ? { rail } : {}),
          label: file.name.slice(0, 200),
          preview: info?.preview,
          aspect: Math.min(10, Math.max(0.1, info?.ratio ?? 4 / 3)),
          progress: 0,
          phase: "upload",
          file,
          ...(collection ? { collection } : {}),
        });
      }
      setGhostList((list) => [...list, ...created]);
      for (const g of created) await processGhost(g.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createProject, processGhost, setGhostList],
  );

  /** Un média de la bibliothèque déposé sur la toile. */
  const dropMedia = useCallback(
    async (mediaId: number, target: DropTargetInfo | null, kind?: string) => {
      if (!target) {
        toast("Dépose l'image sur un projet : entre deux images, ou sur une place vide.", "error");
        return;
      }
      if (target.kind === "media" || target.kind === "cell") placeMedia(target, mediaId, kind);
      else if (target.kind === "gcell") await gridPut(target.uid, target.board, target.index, mediaId, kind, target.props);
      else if (target.kind === "free") await freePut(target.uid, target.board, target.x, target.y, mediaId, kind, target.props);
      else if (target.kind === "new") {
        const created = await createProject(target.uid, "Projet sans titre");
        if (created) await boardDo(created.id, { op: "add", mediaId, index: 0 });
      } else if (target.kind === "bitem") {
        await itemFlushRef.current();
        await boardDo(target.board, { op: "item-media", uid: target.uid, mediaId });
      } else if (target.kind === "slot") await boardDo(target.board, slotBoardOp(target.key, { op: "fill", mediaId }));
      else if (target.kind === "rail") await boardDo(target.board, { op: "rail-add", uid: target.uid, mediaId, index: target.index });
      else await boardDo(target.board, { op: "add", mediaId, index: target.index, ...(target.collection ? { collection: target.collection } : {}) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardDo, createProject],
  );

  const slotOp = async (board: number, key: string, op: "remove" | "retire" | "replace") => {
      if (op === "replace") {
        setPicker({ board, key });
        return;
      }
      const result = await boardDo(board, slotBoardOp(key, { op }));
      if (result) toast(op === "remove" ? "Image retirée · la place reste" : "Place retirée", "success", { label: "Défaire", run: () => undoRef.current() });
  };

  /** Pendant un glisser : aucune sélection de texte native (éditeur), sélection en cours effacée. */
  const noSelection = (on: boolean) => {
    document.documentElement.toggleAttribute("data-ve-dragging", on);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
  };

  /** Glisser un média de l'onglet Médias sur la toile. */
  const [mediaDrag, setMediaDrag] = useState<{ label: string; thumb: string | null; x: number; y: number; over: boolean } | null>(null);
  const onMediaDown = (e: React.PointerEvent<HTMLElement>, m: AdminMediaRow) => {
    if (e.button !== 0 || e.pointerType === "touch" || m.status === "failed") return;
    // Pas de sélection de texte ni de glisser natif dès l'appui.
    e.preventDefault();
    const el = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    dropTargetRef.current = null;
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        dragging = true;
        el.setPointerCapture(ev.pointerId);
        noSelection(true);
      }
      const r = frameRef.current?.getBoundingClientRect();
      const over = Boolean(r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom);
      setMediaDrag({ label: m.name, thumb: m.thumb, x: ev.clientX, y: ev.clientY, over });
      if (over && r) send({ kind: "drag", x: (ev.clientX - r.left) / zoomRef.current, y: (ev.clientY - r.top) / zoomRef.current, label: m.name.slice(0, 120), payload: "media" });
      else if (dropTargetRef.current) {
        dropTargetRef.current = null;
        send({ kind: "drag-end" });
      }
    };
    const end = (commit: boolean) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      if (!dragging) return;
      // Le « clic » qui suit un glisser n'est pas une demande de pose.
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 300);
      noSelection(false);
      const target = dropTargetRef.current;
      dropTargetRef.current = null;
      setMediaDrag(null);
      send({ kind: "drag-end" });
      if (commit) void dropMedia(m.id, target, m.kind);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
  };

  /**
   * Clic (sans glisser) sur une vignette de l'onglet Médias : la pose dans le bloc sélectionné qui peut la
   * recevoir (image, vidéo, fond, portrait ; ou case de la grille sélectionnée), sinon en ouvre l'aperçu.
   */
  const [mediaPreview, setMediaPreview] = useState<AdminMediaRow | null>(null);
  const justDragged = useRef(false);
  const activateMedia = (m: AdminMediaRow) => {
    if (m.status === "failed" || justDragged.current) return;
    // Un composant de la planche est choisi : Image / Vidéo remplacée, Grille et carrousel complétés.
    if (itemSel && itemSel.type !== "rich-text" && !(itemSel.type === "strip" && itemSel.props.source !== "own") && m.status === "ready" && m.kind !== "pdf") {
      void itemFlushRef.current().then(() => boardDo(itemSel.board, { op: "item-media", uid: itemSel.uid, mediaId: m.id }));
      return;
    }
    const block = selected && !selected.startsWith("site-") ? findBlock(draftRef.current.blocks, selected) : null;
    if (block && m.status === "ready" && m.kind !== "pdf") {
      const field = own(byType, block.type)?.mediaFields?.find((f) => f.kind === m.kind || (f.kind === "any" && m.kind !== "pdf"));
      if (field) return placeMedia({ kind: "media", uid: block.uid, field: field.field as "mediaId" | "backgroundMediaId" | "portraitMediaId" }, m.id, m.kind);
      if (block.type === "grid") return placeMedia({ kind: "cell", uid: block.uid }, m.id, m.kind);
      // Planche libre (lot 42) : l'image se pose vers le centre de la zone (le glisser sur la toile choisit l'endroit).
      if (block.type === "free-board") return void freeChoose({ uid: block.uid }, m.id, m.kind);
      // Projet (bloc « Planche d'un projet ») : l'image s'ajoute à la fin de sa bande, comme dans une grille.
      if (block.type === "project-board") {
        const slug = (block.props as { project?: unknown }).project;
        const project = typeof slug === "string" ? projectsList.find((p) => p.slug === slug) : undefined;
        if (project) {
          void boardDo(project.id, { op: "add", mediaId: m.id, index: 0, end: true }).then((r) => r && toast(`« ${m.name} » ajoutée au projet`, "success", { label: "Défaire", run: () => undoRef.current() }));
          return;
        }
      }
    }
    setMediaPreview(m);
  };

  // Envois de l'onglet Médias (Uploader) : la grille se met à jour sans rechargement.
  const queue = useUploadQueue();
  const uploadedCount = queue.items.filter(isUploaded).length;
  const lastUploaded = useRef(uploadedCount);
  useEffect(() => {
    if (uploadedCount > lastUploaded.current) router.refresh();
    lastUploaded.current = uploadedCount;
  }, [uploadedCount, router]);
  // Médias en traitement : la grille et le sélecteur sont un instantané du serveur ; sans ce suivi,
  // une image restait « Conversion… » (sans miniature, impossible à placer) jusqu'au rechargement.
  const processingIds = context.media.filter((m) => m.status === "processing").map((m) => m.id);
  useMediaWatch(processingIds, (rows) => {
    if (rows.some((r) => r.status !== "processing")) router.refresh();
  });

  /** Texte ou opération sur l'en-tête / le pied / les réseaux venus de la toile. */
  const siteChange = (msg: Extract<FromCanvasMsg, { kind: "site-text" | "site-op" }>, seq?: number) => {
    // Refus (valeur invalide, en-tête tenu par une autre page, connexion perdue) : la toile retire son aperçu.
    const revert = () => seq && send({ kind: "revert", seq });
    // Calculé dans le verrou, sur le dernier état écrit : les rangs de la toile comptent ses aperçus en
    // attente, c'est-à-dire les intentions précédentes, déjà écrites quand celle-ci s'exécute.
    let done: string | undefined;
    void writeSite((cur) => {
      const result = msg.kind === "site-text" ? siteText(cur, msg) : applySiteOp(cur, msg, pages);
      if ("error" in result) return result;
      done = result.done;
      return result.snap;
    }).then((ok) => {
      if (!ok) revert();
      else if (done) toast(done, "success", { label: "Défaire", run: () => void undoRef.current() });
    });
  };

  /* ---- Contenu de la planche d'un projet (lot 31) --------------------------------- */

  // Composant de planche dont les réglages sont ouverts dans le panneau (props = dernier état connu, saisie comprise).
  const [itemSel, setItemSel] = useState<{ board: number; uid: string; type: BoardItemType; props: Record<string, unknown>; box?: BoardBoxProps } | null>(null);
  // Composant de la palette glissé au-dessus d'une planche : où il se poserait (BoardLayer).
  const itemDropRef = useRef<{ board: number; index: number } | null>(null);
  const itemTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const itemPending = useRef<{ board: number; uid: string; props?: Record<string, unknown>; box?: BoardBoxProps | null } | null>(null);
  useEffect(() => {
    itemFlushRef.current = async () => {
      clearTimeout(itemTimer.current);
      const p = itemPending.current;
      itemPending.current = null;
      if (p) await boardDo(p.board, { op: "item-set", uid: p.uid, ...(p.props ? { props: p.props } : {}), ...(p.box !== undefined ? { box: p.box } : {}) });
    };
  });
  /** Après une écriture ou un retour en arrière : le panneau suit l'état écrit (ou se ferme si le composant a disparu). */
  const syncItem = (snap: BoardSnap) => {
    setItemSel((cur) => {
      if (!cur || cur.board !== snap.projectId) return cur;
      const item = snap.layout.find((i) => i.uid === cur.uid);
      return item ? { ...cur, type: item.type, props: itemPending.current ? cur.props : item.props, box: itemPending.current ? cur.box : item.box } : null;
    });
  };
  const syncItemRef = useRef(syncItem);
  useEffect(() => {
    syncItemRef.current = syncItem;
  });

  const itemAdd = async (board: number, type: BoardItemType, index: number, source?: "project") => {
    await itemFlushRef.current();
    const r = await boardDo(board, { op: "item-add", type, index, ...(source ? { source } : {}) });
    if (!r) return;
    const added = r.after.layout[index];
    if (added && !(added.type === "strip" && added.props.source !== "own")) {
      setSelected(null);
      send({ kind: "select", uid: null });
      setItemSel({ board, uid: added.uid, type: added.type, props: added.props, ...(added.box ? { box: added.box } : {}) });
      setTab("reglages");
      if (mobile) setSheet(true);
    }
    toast(`« ${BOARD_ITEM_LABELS[type]} » ajouté`, "success", { label: "Défaire", run: () => undoRef.current() });
  };
  const itemOp = async (board: number, uid: string, op: "up" | "down" | "remove") => {
    await itemFlushRef.current();
    const r = await boardDo(board, { op: op === "remove" ? "item-remove" : "item-move", uid, ...(op === "remove" ? {} : { dir: op }) } as BoardOp);
    if (r && op === "remove") toast("Bloc supprimé", "success", { label: "Annuler", run: () => undoRef.current() });
  };
  const itemSelect = (board: number, uid: string, type: BoardItemType, props: string) => {
    void itemFlushRef.current();
    let parsed: Record<string, unknown> = {};
    let box: BoardBoxProps | undefined;
    try {
      const v = JSON.parse(props) as { props?: unknown; box?: BoardBoxProps };
      if (v && typeof v === "object" && v.props && typeof v.props === "object" && !Array.isArray(v.props)) parsed = v.props as Record<string, unknown>;
      if (v?.box && typeof v.box === "object") box = v.box;
    } catch {}
    setSelected(null);
    send({ kind: "select", uid: null });
    setItemSel({ board, uid, type, props: parsed, ...(box ? { box } : {}) });
    setTab("reglages");
    if (mobile) setSheet(true);
  };
  /** Réglages du composant (contenu : `props` ; largeur et alignement : `box`, null = rendu d'avant) : une écriture après 600 ms de calme. */
  const itemChange = (patch: { props?: Record<string, unknown>; box?: BoardBoxProps | null }) => {
    const cur = itemSel;
    if (!cur) return;
    setItemSel({ ...cur, ...(patch.props ? { props: patch.props } : {}), ...(patch.box !== undefined ? { box: patch.box ?? undefined } : {}) });
    itemPending.current = { board: cur.board, uid: cur.uid, ...(itemPending.current?.props ? { props: itemPending.current.props } : {}), ...(itemPending.current?.box !== undefined ? { box: itemPending.current.box } : {}), ...patch };
    clearTimeout(itemTimer.current);
    itemTimer.current = setTimeout(() => void itemFlushRef.current(), 600);
  };
  /** Fond de couleur d'un composant de la planche (lot 32) ; la roue de couleur envoie en continu : une écriture après 300 ms de calme. */
  const fondTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const itemFond = async (board: number, uid: string, background: Background | null, continuous = false) => {
    clearTimeout(fondTimer.current);
    if (continuous) {
      fondTimer.current = setTimeout(() => void handlers.current.itemFond(board, uid, background), 300);
      return;
    }
    await itemFlushRef.current();
    await boardDo(board, { op: "item-fond", uid, background });
  };
  /**
   * Habillage d'un composant Image / Vidéo de la planche (écriture commune `media-look`, lot 75) : les réglages qui se suivent (la roue de
   * couleur envoie en continu) sont fusionnés et écrits après 250 ms de calme, en UNE écriture de planche = un pas d'historique.
   */
  const mediaItemTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mediaItemPending = useRef<{ board: number; uid: string; patch: MediaPatch } | null>(null);
  const itemMediaLook = (board: number, uid: string, patch: MediaPatch) => {
    const cur = mediaItemPending.current;
    // Une autre cible que celle en attente : celle-ci part tout de suite, rien n'est perdu.
    if (cur && (cur.board !== board || cur.uid !== uid)) void flushItemMediaLook();
    mediaItemPending.current = { board, uid, patch: { ...(mediaItemPending.current?.board === board && mediaItemPending.current.uid === uid ? mediaItemPending.current.patch : {}), ...patch } };
    clearTimeout(mediaItemTimer.current);
    mediaItemTimer.current = setTimeout(() => void flushItemMediaLook(), 250);
  };
  const flushItemMediaLook = async () => {
    clearTimeout(mediaItemTimer.current);
    const p = mediaItemPending.current;
    mediaItemPending.current = null;
    if (!p) return;
    await itemFlushRef.current();
    await handlers.current.boardDo(p.board, { op: "item-media-look", uid: p.uid, patch: p.patch });
  };
  /**
   * Un carrousel vit dans une « Planche d'un projet » : jamais sur la page seule. Quand il faut le poser sous une rubrique qui n'est
   * pas une planche (une grille, un texte…), on ajoute une planche NEUVE à cet endroit exact, sélectionnée, et on dit quoi faire :
   * choisir son projet, puis recliquer. Surtout pas dans une autre planche de la page (lot 69 : c'était la cause du carrousel
   * qui atterrissait « dans la planche » au lieu de se placer sous la grille).
   */
  const addBoardForCarousel = (place: Place) => {
    insert("project-board", place);
    toast("« Images qui défilent » se place dans un bloc « Projet » : j'en ai ajouté un ici. Choisis son projet, puis clique de nouveau sur « Images qui défilent ».", "success");
  };
  /**
   * Clic sur la carte « Images qui défilent » de la palette (lot 31c) : un carrousel s'ajoute sous le composant de planche
   * choisi, sinon à la fin de la planche de la rubrique choisie ; sous une autre rubrique, une planche neuve est posée juste dessous
   * (lot 69) ; ailleurs, un message dit où le poser. `at` : l'endroit choisi dans « Ajouter une rubrique » (entre deux rubriques).
   */
  const addCarousel = async (at?: Place) => {
    if (at) {
      addBoardForCarousel(at);
      return;
    }
    if (itemSel) {
      await itemFlushRef.current();
      const r = await boardDo(itemSel.board, { op: "item-add", type: "strip", index: 0, after: itemSel.uid });
      if (r) toast("« Images qui défilent » ajouté sous le bloc choisi", "success", { label: "Défaire", run: () => void undoRef.current() });
      return;
    }
    const list = draftRef.current.blocks;
    const block = selected && !selected.startsWith("site-") ? findBlock(list, selected) : null;
    if (block?.type === "project-board") {
      send({ kind: "board-add", uid: block.uid, item: "strip" });
      return;
    }
    if (block) {
      // Juste sous la rubrique choisie (dans son conteneur si celui-ci accepte une planche, sinon à la suite de la rubrique de premier niveau).
      const here = locate(list, block.uid);
      if (here && canPlace(list, { type: "project-board", props: {} }, here.parent)) addBoardForCarousel({ parent: here.parent, index: here.index + 1 });
      else {
        const top = here ? (walkTree(list).find((v) => v.block.uid === block.uid)?.ancestors[0]?.uid ?? block.uid) : block.uid;
        const topAt = locate(list, top);
        addBoardForCarousel({ parent: null, index: topAt ? topAt.index + 1 : list.length });
      }
      return;
    }
    // Rien de choisi : un seul bloc « Planche d'un projet » sur la page, c'est là que le carrousel va ; sinon on explique le geste.
    const boardsHere = walkTree(list).map((v) => v.block).filter((b) => b.type === "project-board" && typeof (b.props as { project?: unknown }).project === "string");
    if (boardsHere.length === 1) {
      send({ kind: "board-add", uid: boardsHere[0].uid, item: "strip" });
      return;
    }
    toast(
      boardsHere.length > 1
        ? "« Images qui défilent » se place dans un projet. Il y en a plusieurs sur cette page : clique sur le bloc « Projet » voulu, puis sur « Images qui défilent »."
        : "« Images qui défilent » se place dans un projet. Ajoute d'abord un bloc « Projet » à la page et choisis son projet, puis reviens ici.",
      "error",
    );
  };
  /**
   * « Afficher en : Grille / Images qui défilent » (lot 69) : le composant de la planche change de forme SUR PLACE (src/blocks/grid-strip.ts).
   * Les réglages par image du carrousel (cadre, fond, arrondi, lecture) vivent dans la rubrique de la page qui montre la planche : ils sont
   * mis à jour avec elle, en UN seul pas d'historique (« Défaire » rend l'état de départ d'un coup).
   */
  const convertItem = async (board: number, uid: string, to: "grid" | "strip") => {
    await itemFlushRef.current();
    // Dernier état écrit de la planche ; sinon (rien encore écrit dans cette séance) ce que la toile a lu et que le panneau montre.
    const known = boards.current.get(board)?.layout.find((i) => i.uid === uid);
    const item = known ?? (itemSel && itemSel.board === board && itemSel.uid === uid ? { uid, type: itemSel.type, props: itemSel.props, ...(itemSel.box ? { box: itemSel.box } : {}) } : undefined);
    if (!item) {
      toast("Ce bloc n'est plus sur le projet : recharge l'éditeur.", "error");
      return;
    }
    const slug = projectsList.find((p) => p.id === board)?.slug;
    const list = draftRef.current.blocks;
    const shows = walkTree(list).map((v) => v.block).filter((b) => b.type === "project-board" && (b.props as { project?: unknown }).project === slug);
    const holder = shows.find((b) => b.uid === selected) ?? shows[0];
    const kinds: Record<number, "image" | "video"> = {};
    for (const m of context.media) if (m.kind === "image" || m.kind === "video") kinds[m.id] = m.kind;
    const res = convertBoardItem(item, to, { kinds, newUid, look: holder?.props.look as Record<string, unknown> | undefined });
    if ("error" in res) {
      toast(res.error, "error");
      return;
    }
    const done = await boardDo(board, { op: "item-convert", uid, to, props: res.item.props });
    if (!done) return;
    if (holder && JSON.stringify(res.look ?? null) !== JSON.stringify(holder.props.look ?? null)) {
      const before = history.current.past.length;
      setBlocks(
        updateBlock(draftRef.current.blocks, holder.uid, (b) => {
          const props = { ...b.props };
          if (res.look) props.look = res.look;
          else delete props.look;
          return { ...b, props };
        }),
      );
      // Un seul pas d'historique pour toute la conversion (planche + rubrique) : « Défaire » rend l'état de départ d'un coup.
      const past = history.current.past;
      const first = past.at(-2);
      if (past.length === before + 1 && first?.board) {
        history.current = { ...history.current, past: [...past.slice(0, -2), first] };
        bumpHistory();
      }
    }
    toast(to === "strip" ? "Affiché en « Images qui défilent » : tes images, légendes et cadres sont gardés" : "Affiché en grille : tes images, légendes et cadres sont gardés", "success", { label: "Défaire", run: () => void undoRef.current() });
  };
  /** Déplacer un composant à un rang (glisser par la poignée). */
  const itemTo = async (board: number, uid: string, index: number) => {
    await itemFlushRef.current();
    await boardDo(board, { op: "item-to", uid, index });
  };

  const itemFlush = () => itemFlushRef.current();
  const handlers = useRef({ itemFlush, convertItem, itemAdd, itemOp, itemFond, itemMediaLook, mediaLook, itemSelect, itemTo, op, editText, fieldOp, tileOp, insert, undo, redo, selectBlock, createProject, setBoardProject, slotOp, boardDo, uploadFiles, processGhost, setGhostList, setProp, mediaOp, siteChange, moveTree, formField, applyLook, applySiteStyle, applySiteTextStyle, applySiteZoneStyle, applySurface, applyBackground, applyFond, requestInsert, requestCellMedia, queueLook, gridOp, cellLook, freeOp, videoMode });
  useEffect(() => {
    handlers.current = { itemFlush, convertItem, itemAdd, itemOp, itemFond, itemMediaLook, mediaLook, itemSelect, itemTo, op, editText, fieldOp, tileOp, insert, undo, redo, selectBlock, createProject, setBoardProject, slotOp, boardDo, uploadFiles, processGhost, setGhostList, setProp, mediaOp, siteChange, moveTree, formField, applyLook, applySiteStyle, applySiteTextStyle, applySiteZoneStyle, applySurface, applyBackground, applyFond, requestInsert, requestCellMedia, queueLook, gridOp, cellLook, freeOp, videoMode };
  });
  // Polices déjà téléchargées : marquées dans le menu des polices de la toile.
  useEffect(() => {
    if (frameReady) send({ kind: "fonts", installed: fontFamilies.slice(0, 20), busy: fontBusy });
  }, [frameReady, fontFamilies, fontBusy, send]);

  // Toile : pages proposables pour le menu, et verrou de l'en-tête.
  const navPagesRef = useRef<{ id: number; title: string }[]>([]);
  const navPages = useMemo(() => {
    const inNav = new Set(siteSnap.nav.flatMap((i) => (i.kind === "page" ? [i.pageId] : [])));
    return pages.filter((p) => !inNav.has(p.id)).map((p) => ({ id: p.id, title: p.title.slice(0, 200) }));
  }, [pages, siteSnap]);
  useEffect(() => {
    navPagesRef.current = navPages;
    if (frameReady) send({ kind: "pages", list: navPages });
  }, [frameReady, navPages, send]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Origine, source (l'iframe de la toile) et schéma vérifiés ; sinon ignoré.
      const msg = acceptFromCanvas(event, window.location.origin, frameRef.current?.contentWindow);
      if (!msg) return;
      const h = handlers.current;
      // Une toile (re)chargée recompte depuis 1 ; sinon, le plus grand numéro reçu.
      if (msg.kind === "ready") seenSeq.current = msg.seq ?? 0;
      else if (msg.seq) seenSeq.current = Math.max(seenSeq.current, msg.seq);
      switch (msg.kind) {
        case "ready": {
          let path = msg.path;
          try {
            path = decodeURI(msg.path);
          } catch {}
          const own = path.replace(/\/$/, "") === paths[locale] || (path === `/${locale}/` && paths[locale] === `/${locale}`);
          setForeign(!own);
          setFrameReady(true);
          // Changement de langue : la toile est prête, la page reprend sa place ; une page étrangère (lien suivi en aperçu) repart d'en haut.
          if (own) restoreLangScroll();
          langSnap.current = null;
          setCanvasBlocks(msg.blocks);
          // Une autre page (lien suivi en aperçu) : jamais éditable ici.
          send({ kind: "mode", mode: own ? mode : "preview" });
          if (own && selected) send({ kind: "select", uid: selected });
          send({
            kind: "projects",
            list: projectsList.map((p) => ({ slug: p.slug, title: p.title.slice(0, 200), ...(p.draft ? { draft: true } : {}), ...("onPage" in p ? { onPage: Boolean(p.onPage) } : {}) })),
          });
          send({ kind: "ghosts", items: ghostsRef.current.map(toWire) });
          send({ kind: "pages", list: navPagesRef.current });
          break;
        }
        case "blocks":
          setCanvasBlocks(msg.blocks);
          break;
        case "board-create":
          void h.createProject(msg.uid, msg.name ?? "", true);
          break;
        case "board-pick":
          h.setBoardProject(msg.uid, msg.slug);
          break;
        case "slot-op":
          void h.slotOp(msg.board, msg.key, msg.op);
          break;
        case "bitem-add":
          void h.itemAdd(msg.board, msg.item, msg.index, msg.source);
          break;
        case "bitem-text":
        case "bitem-look": {
          // Refusé (planche tenue ailleurs, composant disparu…) ou échec : la toile retire l'aperçu.
          const seq = msg.seq;
          const op: BoardOp = msg.kind === "bitem-text" ? { op: "item-text", uid: msg.uid, path: msg.path, locale: msg.locale, value: msg.value } : { op: "item-look", uid: msg.uid, look: msg.look };
          void h.itemFlush().then(() => h.boardDo(msg.board, op)).then((r) => {
            if (!r && seq) send({ kind: "revert", seq });
          });
          break;
        }
        case "board-captions": {
          const seq = msg.seq;
          void h.itemFlush().then(() => h.boardDo(msg.board, { op: "captions-style", style: msg.style })).then((r) => {
            if (!r && seq) send({ kind: "revert", seq });
          });
          break;
        }
        case "bitem-drop":
          itemDropRef.current = msg.board ? { board: msg.board, index: msg.index } : null;
          break;
        case "bitem-to":
          void h.itemTo(msg.board, msg.uid, msg.index);
          break;
        case "bitem-op":
          void h.itemOp(msg.board, msg.uid, msg.op);
          break;
        case "bitem-fond":
          void h.itemFond(msg.board, msg.uid, msg.background, msg.continuous);
          break;
        case "bitem-select":
          h.itemSelect(msg.board, msg.uid, msg.item, msg.props);
          break;
        case "slot-move":
          void h.boardDo(msg.board, slotBoardOp(msg.key, { op: "move", index: msg.index }));
          break;
        case "slot-text":
        case "project-text": {
          const op: BoardOp =
            msg.kind === "slot-text"
              ? { op: "text", key: msg.key, field: msg.field, locale: msg.locale, value: msg.value }
              : { op: "project", field: msg.field, locale: msg.locale, value: msg.value };
          const seq = msg.seq;
          // Refusé (planche tenue ailleurs, titre vide…) ou échec : la toile retire l'aperçu et rétablit le texte.
          void h.boardDo(msg.board, op).then((r) => {
            if (!r && seq) send({ kind: "revert", seq });
          });
          break;
        }
        case "drop-target":
          dropTargetRef.current = msg.target;
          break;
        case "files":
          void h.uploadFiles(msg.target, msg.files);
          break;
        case "ghost-op":
          if (msg.op === "retry") void h.processGhost(msg.id);
          else h.setGhostList((list) => list.filter((g) => g.id !== msg.id));
          break;
        case "select":
          setItemSel(null);
          h.selectBlock(msg.uid, { notify: false });
          // Un clic sur une rubrique de la toile ouvre ses Réglages (depuis Ajouter ou Structure) ; « Ajouter » ajoute ensuite sous elle.
          // Médias reste ouvert : on y glisse des images vers les planches, un clic pour viser une planche ne doit pas le fermer.
          if (msg.uid && msg.click) setTab((t) => (t === "medias" ? t : "reglages"));
          break;
        case "op":
          h.op(msg.op, msg.uid);
          break;
        case "move":
          h.moveTree(msg.uid, msg.parent ?? null, msg.index);
          break;
        case "media-op":
          h.mediaOp(msg.uid, msg.field, msg.op);
          break;
        case "layout":
          void h.gridOp({ kind: "grid-op", uid: msg.uid, op: { op: "set", layout: msg.layout } });
          break;
        case "grid-op":
          void h.gridOp(msg);
          break;
        case "free-op":
          // Refusé ou sans effet : la toile retire son aperçu et rétablit la valeur d'origine.
          void h.freeOp(msg).then((ok) => {
            if (!ok && msg.seq) send({ kind: "revert", seq: msg.seq });
          });
          break;
        case "video-mode":
          void h.videoMode(msg);
          break;
        case "media-look":
          // Refusé (cible disparue, réglage sans place ici) ou sans effet : la toile retire son aperçu.
          void h.mediaLook(msg).then((ok) => {
            if (!ok && msg.seq) send({ kind: "revert", seq: msg.seq });
          });
          break;
        case "cell-look":
          void h.cellLook(msg).then((ok) => {
            if (!ok && msg.seq) send({ kind: "revert", seq: msg.seq });
          });
          break;
        case "tile-op":
          if (!h.tileOp(msg) && msg.seq) send({ kind: "revert", seq: msg.seq });
          break;
        case "tile-size":
          h.setProp(msg.uid, "size", msg.size);
          break;
        case "form-field": {
          // Refusé (dernier champ, champ de réponse, limite…) ou sans effet : la toile retire son aperçu.
          const before = draftRef.current;
          if ((!h.formField(msg) || draftRef.current === before) && msg.seq) send({ kind: "revert", seq: msg.seq });
          break;
        }
        case "site-text":
        case "site-op":
          h.siteChange(msg, msg.seq);
          break;
        case "text":
          if (!h.editText(msg.uid, msg.path, msg.locale, msg.value) && msg.seq) send({ kind: "revert", seq: msg.seq });
          break;
        case "look": {
          const seq = msg.seq;
          void h.applyLook(msg.uid, msg.look).then((ok) => {
            if (!ok && seq) send({ kind: "revert", seq });
          });
          break;
        }
        case "site-style":
          h.applySiteStyle(msg.role, msg.style);
          break;
        case "site-text-style":
          h.applySiteTextStyle(msg.key, msg.style);
          break;
        case "site-zone-style":
          h.applySiteZoneStyle(msg.zone, msg.style);
          break;
        case "background":
          if (!h.applyBackground(msg.uid, msg.background, msg.continuous) && msg.seq) send({ kind: "revert", seq: msg.seq });
          break;
        case "fond":
          if (!h.applyFond(msg.uid, msg.surface, msg.background, msg.continuous) && msg.seq) send({ kind: "revert", seq: msg.seq });
          break;
        case "page-settings":
          // Lot 66 (R5) : le menu Fond renvoie au papier peint de la page (Réglages, aucun bloc choisi).
          h.selectBlock(null);
          setTab("reglages");
          if (mobile) setSheet(true);
          setTimeout(() => document.querySelector('[data-testid="page-wallpaper"]')?.scrollIntoView({ block: "center" }), 150);
          break;
        case "surface":
          // Refusé (composant d'un conteneur) ou sans effet : la toile retire son aperçu.
          if (!h.applySurface(msg.uid, msg.surface, msg.continuous) && msg.seq) send({ kind: "revert", seq: msg.seq });
          break;
        case "field-op":
          h.fieldOp(msg.uid, msg.op);
          break;
        case "insert":
          h.requestInsert(msg.parent, msg.index, msg.what);
          break;
        case "cell-media":
          h.requestCellMedia(msg.uid, msg.media);
          break;
        case "site-look":
          lookEchoed.current++;
          h.queueLook(msg.palette, msg.logo, msg.seq);
          break;
        case "modal":
          setCanvasModal(msg.open);
          break;
        case "highlight-info":
          setHlInfo({ role: msg.role, count: msg.count, uses: msg.uses });
          break;
        case "drag-index":
          dropIndexRef.current = msg.refused ? null : { parent: msg.parent ?? null, index: msg.index };
          setDropIndex(msg.refused ? null : msg.index);
          setDropRefused(Boolean(msg.refused));
          break;
        case "key":
          if (msg.key === "undo") h.undo();
          else if (msg.key === "redo") h.redo();
          else if (msg.key === "escape" && mode === "preview") setMode("edit");
          break;
      }
      // Intention numérotée sans écriture à la clé (refusée, inchangée) : la toile peut lâcher son aperçu.
      if (msg.seq && CANVAS_INTENTS.has(msg.kind)) queueMicrotask(settleIfQuiet);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, mode, locale, paths, selected, mobile, projectsList, restoreLangScroll]);

  useEffect(() => {
    if (frameReady && !foreign) send({ kind: "mode", mode });
  }, [mode, frameReady, foreign, send]);

  /* ---- Clavier de l'éditeur ---------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape" && mode === "preview") {
        e.preventDefault();
        setMode("edit");
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape" && selected) {
        selectBlock(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, selected, undo, redo, selectBlock]);

  /* ---- Glisser un composant de la palette sur la toile -------------------- */

  const [paletteDrag, setPaletteDrag] = useState<{ type: string; label: string; x: number; y: number; over: boolean } | null>(null);

  /** Conteneurs qu'apporte un composant de la palette (une grille : 1). */
  const nestingOfEntry = (entry: Pick<BlockCatalogEntry, "container">) => (entry.container ? 1 : 0);

  /** `starter` : glissé depuis un raccourci Texte (Texte, Titre, Titre + texte) plutôt qu'une carte du catalogue. */
  const onPaletteDown = (e: React.PointerEvent<HTMLButtonElement>, entry: Pick<BlockCatalogEntry, "key" | "type" | "label" | "container">, starter?: TextStarter) => {
    if (e.button !== 0) return;
    const card = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    // Au doigt (tablette) : un appui long (350 ms) arme le glisser ; bouger avant, c'est faire défiler le panneau ; un simple toucher ajoute, comme avant.
    const touch = e.pointerType === "touch";
    let armed = !touch;
    const stopScroll = (ev: TouchEvent) => ev.preventDefault();
    const noMenu = (ev: Event) => ev.preventDefault();
    const timer = touch
      ? setTimeout(() => {
          armed = true;
          // Armé : le doigt glisse le composant, la page ne défile plus.
          document.addEventListener("touchmove", stopScroll, { passive: false });
        }, 350)
      : undefined;
    if (touch) card.addEventListener("contextmenu", noMenu);
    const frameRect = () => frameRef.current?.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (touch && !armed) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) end(false);
          return;
        }
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        dragging = true;
        card.setPointerCapture(ev.pointerId);
        dropIndexRef.current = null;
        itemDropRef.current = null;
        // Pas de sélection de texte du navigateur pendant le glisser.
        noSelection(true);
      }
      const r = frameRect();
      const over = Boolean(r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom);
      setPaletteDrag({ type: entry.type, label: entry.label, x: ev.clientX, y: ev.clientY, over });
      if (over && r) send({ kind: "drag", x: (ev.clientX - r.left) / zoomRef.current, y: (ev.clientY - r.top) / zoomRef.current, label: entry.label, blockType: entry.type, nesting: nestingOfEntry(entry) });
      else if (dropIndexRef.current !== null || dropRefused) {
        dropIndexRef.current = null;
        itemDropRef.current = null;
        setDropIndex(null);
        setDropRefused(false);
        send({ kind: "drag-end" });
      }
    };
    const end = (commit: boolean) => {
      clearTimeout(timer);
      document.removeEventListener("touchmove", stopScroll);
      card.removeEventListener("contextmenu", noMenu);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", esc, true);
      if (!dragging) return;
      // Le clic qui suit un glisser ne doit pas insérer une seconde fois.
      card.dataset.dragged = "1";
      setTimeout(() => delete card.dataset.dragged, 0);
      const place = dropIndexRef.current;
      // Au-dessus d'une planche : le composant se pose DANS la planche (entre ses composants), jamais dans la page.
      const intoBoard = itemDropRef.current;
      itemDropRef.current = null;
      setPaletteDrag(null);
      setDropIndex(null);
      setDropRefused(false);
      dropIndexRef.current = null;
      noSelection(false);
      send({ kind: "drag-end" });
      if (commit && intoBoard) {
        void itemAdd(intoBoard.board, entry.type === "board-strip" ? "strip" : (entry.type as BoardItemType), intoBoard.index);
        return;
      }
      if (commit && place !== null) {
        if (starter) insertStarter(starter, place);
        else insert(entry.key, place);
      }
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        end(false);
      }
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", esc, true);
  };

  /* ---- Publier, abandonner ----------------------------------------------- */

  const publish = async (live = false) => {
    setAskLive(false);
    setPublishing(true);
    try {
      await commitLookRef.current();
      clearTimeout(timer.current);
      const result = await withLock(async () => {
        if (dirty.current && !(await runSave())) return null;
        return publishDraftAction(pageId, revRef.current, live);
      });
      if (!result) {
        toast("Le brouillon n'est pas enregistré : réessaie.", "error");
        return;
      }
      if (!result.ok) reportSaveFailure("publishDraftAction", result);
      if (!result.ok && "code" in result) {
        blockedRef.current = result.code;
        setBlocked(result.code);
        return;
      }
      if (!result.ok) {
        const fe = result.fieldErrors ?? {};
        setPublishErrors(fe);
        setPublishMessage(result.message);
        // Premier bloc ou composant signalé (chemin « blocks.2.props.children.0… »).
        const uid = Object.keys(fe)
          .map((k) => blockAtPath(draftRef.current.blocks, k)?.uid)
          .find((v) => v !== undefined);
        if (uid) {
          selectBlock(uid, { scroll: true });
          setTab("reglages");
          if (mobile) setSheet(true);
        }
        toast("Publication impossible : la liste des points à corriger est en haut de la page.", "error");
        return;
      }
      revRef.current = result.data.rev;
      // v0.33.6 : la publication a rangé un brouillon de projet tenu dans la copie propre du bloc Projet : l éditeur la reprend AVANT le renommage des blocs (repères du brouillon),
      // sinon son prochain enregistrement (une couleur…) effacerait la copie du brouillon, et la publication suivante celle de la page.
      if (result.data.foldedOwn?.length) syncOwnBlock(result.data.foldedOwn as { uid: string; layout: BoardItem[] | null; text: unknown }[]);
      // Publié : les instantanés de planche d'avant ne sont plus des brouillons.
      history.current = { past: [], future: [] };
      boards.current.clear();
      bumpHistory();
      setPublishErrors({});
      setPublishMessage(null);
      const warn = result.data.warnings;
      setPublishWarn(warn && (warn.missingAlt.length > 0 || warn.untranslated > 0 || warn.notInMenu) ? warn : null);
      setHasDraft(false);
      // Lot 115 : une page publiée n'a plus de repères de blocs (`b<rang>`, voir readDraft) : la toile se redessine d'après elle, alors que
      // l'éditeur gardait les siens (blocs ajoutés `n…`, blocs déplacés ou retirés). Sans ce raccord, un réglage fait sur la toile (couleur de
      // texte…) visait un bloc inconnu (perdu au rechargement) ou un AUTRE bloc de l'éditeur (ses réglages remplacés par ceux du bloc voisin).
      const ranked = draftRef.current.blocks.map((b, i) => (b.uid === `b${i}` ? b : { ...b, uid: `b${i}` }));
      const renamed = ranked.some((b, i) => b !== draftRef.current.blocks[i]);
      if (renamed || result.data.wentLive) {
        // La page est maintenant en ligne : l'état de l'en-tête (et le brouillon enregistré ensuite) le disent aussi.
        const inSync = JSON.stringify(draftRef.current) === savedJson.current;
        draftRef.current = { ...draftRef.current, blocks: ranked, ...(result.data.wentLive ? { published: true } : {}) };
        setDraftState(draftRef.current);
        if (inSync) savedJson.current = JSON.stringify(draftRef.current);
        // Le bloc choisi a changé de nom (ou de voisin) : plus de sélection plutôt qu'un autre bloc choisi.
        if (renamed && selected && !selected.startsWith("site-")) selectBlock(null);
      }
      toast(result.data.site ? "Publié : la page est en ligne, l'en-tête et le pied de page sont à jour sur toutes les pages" : "Publié : la page est en ligne");
      setSitePending(false);
      if (typeof result.data.siteRev === "number") siteRevRef.current = result.data.siteRev;
      send(refreshMsg(false));
      router.refresh();
      // Lot 118 : les autres onglets de l'artiste (aperçu, site) abandonnent leur cache de navigation et se rafraîchissent.
      announcePublished();
    } finally {
      setPublishing(false);
    }
  };

  /** « Ajouter au menu » de l'avertissement de publication (lot 67, CONC-02) : la page entre au menu, le brouillon local suit. */
  const addToMenu = async () => {
    const result = await addToMenuFromEditorAction(pageId);
    if (!result.ok) {
      toast(result.message ?? "Impossible d'ajouter la page au menu.", "error");
      return;
    }
    const inSync = JSON.stringify(draftRef.current) === savedJson.current;
    draftRef.current = { ...draftRef.current, inMenu: true };
    setDraftState(draftRef.current);
    if (inSync) savedJson.current = JSON.stringify(draftRef.current);
    setPublishWarn((w) => (w ? { ...w, notInMenu: false } : w));
    toast("La page est dans le menu");
    router.refresh();
  };

  const discard = async () => {
    setDiscardBusy(true);
    clearTimeout(timer.current);
    dirty.current = false;
    const result = await withLock(() => discardDraftAction(pageId, revRef.current));
    if (!result.ok) {
      reportSaveFailure("discardDraftAction", result);
      setDiscardBusy(false);
      setDiscarding(false);
      setResetting(false);
      if ("code" in result && result.code === "conflict") {
        blockedRef.current = "conflict";
        setBlocked("conflict");
      } else toast(result.message, "error");
      return;
    }
    // Repart de la version publiée (état, historique, toile).
    leaving.current = true;
    window.location.reload();
  };

  /** « Annuler ces changements du site » : le brouillon commun disparaît (les brouillons de pages restent). */
  const discardSite = async () => {
    setDiscardSiteBusy(true);
    let result: Awaited<ReturnType<typeof discardSiteDraftAction>>;
    try {
      result = await withLock(() => discardSiteDraftAction(siteRevRef.current));
    } catch {
      result = { ok: false, message: "connexion perdue" };
    }
    setDiscardSiteBusy(false);
    setDiscardingSite(false);
    if (!result.ok) {
      if ("code" in result) stop(result.code);
      else toast(result.message, "error");
      return;
    }
    siteRevRef.current = result.data.rev;
    siteRef.current = result.data.snap;
    setSiteSnap(result.data.snap);
    setSitePending(false);
    // Les pas d'historique qui portent le site n'ont plus de sens.
    history.current = { past: history.current.past.filter((e) => !e.site), future: history.current.future.filter((e) => !e.site) };
    bumpHistory();
    send(refreshMsg(false));
    router.refresh();
    toast("Les changements du site sont annulés : le site en ligne est repris", "success");
  };

  const copyTexts = async () => {
    try {
      await navigator.clipboard.writeText(draftTexts(draftRef.current, byType));
      toast("Textes copiés");
    } catch {
      toast("Copie impossible : ouvre « Voir mes textes en cours ».", "error");
    }
  };

  const goToPage = async (id: number) => {
    await flush();
    router.push(`/admin/pages/${id}/editer?langue=${locale}`);
  };

  /**
   * Quitter l'éditeur vers l'admin (lot 48) : la vue brouillon (draft mode + cookie `page-draft`, posés par la toile) est coupée en même
   * temps, comme par « Quitter l'aperçu » (POST /admin/apercu/quitter) : le site ne s'ouvre plus en Aperçu par surprise. Clic simple seulement
   * (Ctrl / Cmd / clic du milieu : le lien s'ouvre à part, l'éditeur reste en place avec sa vue brouillon).
   */
  const leaveTo = async (e: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    await flush();
    try {
      await fetch("/admin/apercu/quitter", { method: "POST", body: new URLSearchParams({ retour: href }), credentials: "same-origin", redirect: "manual" });
    } catch {
      // Hors ligne : on quitte quand même, la vue brouillon sera coupée à la prochaine sortie.
    }
    leaving.current = true;
    window.location.assign(href);
  };

  /* ---- Rendu -------------------------------------------------------------- */

  // Palette et logo voulus : l'aperçu en attente fait foi sur le brouillon enregistré.
  const liveLook: { palette: SitePalette; logo: Logo } = pendingLook ?? { palette: siteSnap.styles?.palette ?? {}, logo: siteSnap.styles?.logo ?? {} };
  // Pastilles des couleurs du thème dans les panneaux de texte : celles du site (thème + couleurs choisies).
  const effective = effectiveSitePalette(lookContext.theme.color, lookContext.theme.palette ?? undefined, liveLook.palette);
  const swatches = { ink: effective.ink, "ink-soft": effective.inkSoft, primary: effective.primary, secondary: effective.secondary, tertiary: effective.tertiary, eyebrow: effective.eyebrow, bg: effective.bg, surface: effective.surface };

  const selBlock = selected && !selected.startsWith("site-") ? findBlock(blocks, selected) : null;
  const selAt = selBlock ? locate(blocks, selBlock.uid) : null;
  const selSiblings = selAt ? (listOf(blocks, selAt.parent) ?? []) : [];
  const selPath = selBlock ? errorPath(blocks, selBlock) : null;
  const selDef = selBlock ? own(byType, selBlock.type) : undefined;
  const editor = selBlock ? own(editors, selBlock.type) : undefined;
  // Fil d'Ariane du bloc choisi (conteneurs qui l'englobent).
  const selChain = selBlock ? walkTree(blocks).find((v) => v.block.uid === selBlock.uid)?.ancestors ?? [] : [];
  // Publication refusée : la liste des problèmes en français (chaque ligne mène au bon endroit).
  const problems = useMemo(() => describeProblems(blocks, publishErrors, (t) => own(byType, t)?.label ?? t), [blocks, publishErrors, byType]);
  const goToProblem = (p: Problem) => {
    if (p.kind === "block" && p.uid) {
      selectBlock(p.uid, { scroll: true });
      setTab("reglages");
    } else if (p.kind === "page") {
      // Réglages de la page et du site : visibles quand aucun bloc n'est choisi.
      selectBlock(null);
      setTab("reglages");
      if (mobile) setSheet(true);
    }
  };
  const deletingBlock = deleting ? findBlock(blocks, deleting) : null;
  const deletingCount = descendantCount(deletingBlock);
  /** Blocs et composants signalés par la publication (uid). */
  const errorUids = new Set(
    Object.keys(publishErrors)
      .map((k) => blockAtPath(blocks, k)?.uid)
      .filter((v): v is string => v !== undefined),
  );

  // États explicites : la couleur du point dit si le site est à jour.
  const status: { tone: string; text: string; reason?: string } =
    blocked === "conflict"
      ? { tone: "error", text: "Modifié ailleurs" }
      : blocked === "corrupt"
        ? { tone: "error", text: "Brouillon illisible" }
        : saveState === "error"
          ? { tone: "error", text: "Erreur d'enregistrement", reason: saveError ?? undefined }
          : saveState === "saving" || saveState === "pending"
            ? { tone: "busy", text: "Enregistrement…" }
            : !draft.published
              ? { tone: "idle", text: "Pas encore en ligne" }
              : hasDraft || sitePending
                ? { tone: "draft", text: "Modifications non publiées" }
                : { tone: "ok", text: "En ligne" };

  const wide = !mobile && device === "wide";
  const frameWidth = mobile || wide ? null : DEVICES.find((d) => d.id === device)?.width ?? null;
  // Grand écran : la toile garde sa largeur de 1440 px (le contenu se met en page comme sur un grand écran), réduite par un zoom
  // pour tenir dans la place disponible ; la hauteur de la fenêtre suit (hauteur de la toile = hauteur de la boîte / zoom).
  const canvasRef = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !wide) return;
    const measure = () => {
      const cs = getComputedStyle(canvas);
      const w = canvas.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setBox((b) => (Math.abs(b.w - w) < 1 && Math.abs(b.h - wrap.clientHeight) < 1 ? b : { w, h: wrap.clientHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [wide, mode]);
  const zoom = wide && box.w > 0 ? Math.min(1, box.w / WIDE_PX) : 1;
  const zoomRef = useRef(1);
  useEffect(() => {
    zoomRef.current = zoom;
  });
  const frameSrc = `/admin/api/editeur/toile?page=${pageId}&langue=${locale}`;
  const media = context.media;
  const [mediaTags, setMediaTags] = useState<string[]>([]);
  const [mediaQuery, setMediaQuery] = useState("");
  const tagOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of media) for (const t of m.tags) seen.set(t.label.toLowerCase(), t.label);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr"));
  }, [media]);
  // Lot 112 : tri (préférence mémorisée), dates de création lues en tâche de fond, chargement progressif, fichier renvoyé retrouvé.
  const [mediaSort, setMediaSort] = useMediaSort();
  const mediaDated = useTakenDates(media);
  const shownMedia = useMemo(() => sortMedia(filterMedia(mediaDated, mediaTags, mediaQuery), mediaSort), [mediaDated, mediaTags, mediaQuery, mediaSort]);
  const [mediaPage, mediaSentinel] = useProgressive(shownMedia.length, `${mediaSort}|${mediaTags.join(",")}|${mediaQuery}`);
  const [mediaScrollTo, setMediaScrollTo] = useState<number | null>(null);
  const mediaFlash = useReimportReveal(
    media,
    shownMedia,
    () => {
      setMediaTags([]);
      setMediaQuery("");
      setTab("medias");
      if (mobile) setSheet(true);
    },
    (id, index) => {
      mediaPage.ensure(index + 1);
      setMediaScrollTo(id);
    },
  );
  useEffect(() => {
    if (mediaScrollTo === null || tab !== "medias") return;
    const el = document.querySelector<HTMLElement>(`.ve-media [data-media="${mediaScrollTo}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    setMediaScrollTo(null);
  }, [mediaScrollTo, mediaPage.count, tab]);

  const panel = (
    <aside className="ve-panel" data-open={sheet || undefined} aria-label="Outils de l'éditeur" inert={(mobile && !sheet) || canvasModal ? true : undefined}>
      {mobile && (
        <div className="ve-sheet-head">
          <span className="ve-sheet-grab" aria-hidden="true" />
          {hasDraft && !blocked && (
            <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => setDiscarding(true)}>
              Abandonner les modifications
            </button>
          )}
          <button type="button" className="a-btn a-btn-small" onClick={() => setSheet(false)}>
            Fermer
          </button>
        </div>
      )}
      <div className="ve-tabs" role="tablist" aria-label="Panneau">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ve-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`ve-pane-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === tab);
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                setTab(next.id);
                document.getElementById(`ve-tab-${next.id}`)?.focus();
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ve-pane" role="tabpanel" id={`ve-pane-${tab}`} aria-labelledby={`ve-tab-${tab}`}>
        {tab === "ajouter" && (
          <>
            <p className="ve-hint">{mobile ? "Touche un bloc pour l'ajouter sous le bloc choisi." : "Glisse-le sur la page, à l'endroit voulu. Ou clique pour l'ajouter sous le bloc sélectionné."}</p>
            <input
              type="search"
              className="a-input ve-search"
              placeholder="Chercher un bloc"
              aria-label="Chercher un bloc"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
            />
            {addGroups.length === 0 && <p className="ve-empty">Aucun bloc ne correspond à « {addQuery.trim()} ».</p>}
            {addGroups.map((g) => (
              <section key={g.id} className="ve-group" data-group={g.id} aria-label={g.label}>
                <h3 className="ve-group-title">{g.label}</h3>
                {g.starters.length > 0 && (
                  <div className="ve-starters" role="group" aria-label="Ajouter du texte">
                    {g.starters.map((st) => (
                      <button
                        key={st.key}
                        type="button"
                        className="ve-starter"
                        data-starter={st.key}
                        data-dragging={paletteDrag?.label === st.label || undefined}
                        onPointerDown={(e) => onPaletteDown(e, { key: st.key, type: st.block, label: st.label }, st.key)}
                        onClick={(e) => {
                          if (e.currentTarget.dataset.dragged) return;
                          insertStarter(st.key);
                        }}
                      >
                        <BlockThumb type="rich-text" preset={st.key} />
                        <strong>{st.label}</strong>
                      </button>
                    ))}
                  </div>
                )}
                {g.entries.length > 0 && (
                  <ul className="ve-palette">
                    {g.entries.map((c) => {
                      // Une seule fois par page : déjà sur la page, la carte est grisée et dit pourquoi.
                      const taken = Boolean(c.single) && present.has(c.type);
                      return (
                        <li key={c.key} className={c.models.length || taken ? "ve-card-wrap" : undefined}>
                          <button
                            type="button"
                            className="ve-card"
                            data-type={c.type}
                            data-key={c.key}
                            disabled={taken}
                            data-dragging={paletteDrag?.type === c.type || undefined}
                            onPointerDown={(e) => onPaletteDown(e, c)}
                            onClick={(e) => {
                              if (e.currentTarget.dataset.dragged) return;
                              insert(c.key);
                            }}
                          >
                            <BlockThumb type={c.type} preset={c.key} />
                            <span>
                              <strong>{c.label}</strong>
                              <span className="ve-card-desc">{c.description}</span>
                            </span>
                          </button>
                          {taken && (
                            <p className="ve-card-note" data-testid="palette-single-note">
                              {c.single}
                            </p>
                          )}
                          {c.models.length > 0 && (
                            <div className="ve-models" role="group" aria-label={`Modèles de départ : ${c.label}`}>
                              <span className="ve-models-title">Modèles :</span>
                              {c.models.map((m) => (
                                <button
                                  key={m.key}
                                  type="button"
                                  className="ve-model"
                                  data-key={m.key}
                                  data-type={m.type}
                                  title={m.description}
                                  data-dragging={paletteDrag?.label === m.label || undefined}
                                  onPointerDown={(e) => onPaletteDown(e, m)}
                                  onClick={(e) => {
                                    if (e.currentTarget.dataset.dragged) return;
                                    insert(m.key);
                                  }}
                                >
                                  {m.short ?? m.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {g.id === "media" && !addQuery.trim() && (
                  // Lot 31b : le carrousel n'existe que dans une planche de projet : il se glisse entre ses composants.
                  <ul className="ve-palette">
                    <li>
                      <button
                        type="button"
                        className="ve-card"
                        data-type="board-strip"
                        data-key="board-strip"
                        data-dragging={paletteDrag?.type === "board-strip" || undefined}
                        onPointerDown={(e) => onPaletteDown(e, { key: "board-strip", type: "board-strip", label: "Images qui défilent" })}
                        onClick={(e) => {
                          if (e.currentTarget.dataset.dragged) return;
                          void addCarousel();
                        }}
                      >
                        <BlockThumb type="image" preset="board-strip" />
                        <span>
                          <strong>Images qui défilent</strong>
                          <span className="ve-card-desc">Un carrousel d&apos;images et de vidéos de ta médiathèque, dans un bloc « Projet ».</span>
                        </span>
                      </button>
                    </li>
                  </ul>
                )}
              </section>
            ))}
          </>
        )}

        {tab === "medias" && (
          <>
            <Uploader origin={`editeur-${pageId}`} libraryLabel="Voir dans la Médiathèque" />
            <label className="ve-media-search">
              <span className="sr-only">Rechercher par nom ou tag</span>
              <input className="a-input" type="search" placeholder="Rechercher par nom ou tag…" value={mediaQuery} onChange={(e) => setMediaQuery(e.target.value)} />
            </label>
            <MediaSortMenu
              className="ve-media-sort"
              value={mediaSort}
              onChange={(s) => {
                setMediaSort(s);
                document.getElementById("ve-pane-medias")?.scrollTo({ top: 0 });
              }}
            />
            {tagOptions.length > 0 && (
              <div className="ve-chips" role="group" aria-label="Filtrer par tags">
                {tagOptions.map((t) => {
                  const on = mediaTags.includes(t);
                  return (
                    <button key={t} type="button" className="ve-chip" aria-pressed={on} onClick={() => setMediaTags(on ? mediaTags.filter((x) => x !== t) : [...mediaTags, t])}>
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
            {shownMedia.length === 0 ? (
              <p className="ve-empty">{media.length ? "Aucun média ne correspond." : "Ta médiathèque est vide : dépose des fichiers ci-dessus."}</p>
            ) : (
              <ul className="ve-media" aria-label="Médias" onFocus={(e) => loadMoreOnFocus(e, mediaPage.count, mediaPage.more, mediaPage.ensure)}>
                {shownMedia.slice(0, mediaPage.count).map((m) => (
                  <li
                    key={m.id}
                    data-flash={mediaFlash === m.id || undefined}
                    title={`${m.name} : clique pour la poser, glisse-la sur un projet`}
                    data-media={m.id}
                    data-status={m.status}
                    tabIndex={m.status === "failed" ? undefined : 0}
                    role="button"
                    aria-label={`${m.name} : poser ou afficher`}
                    onPointerDown={(e) => onMediaDown(e, m)}
                    onClick={() => activateMedia(m)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        activateMedia(m);
                      }
                    }}
                  >
                    <span className="ve-media-thumb">
                    {m.thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumb} alt="" loading="lazy" draggable={false} />
                    )}
                    {m.kind === "video" && <span className="ve-media-kind" aria-hidden="true">▶</span>}
                    {noDate(m, mediaSort) && <span className="ve-media-nodate" data-testid="media-nodate">Date inconnue</span>}
                    {m.status === "processing" && <span className="ve-media-state">{m.kind === "video" ? "Conversion…" : "Traitement…"}</span>}
                    {m.status === "failed" && (
                      <span className="ve-media-state" data-failed="" title={m.error ?? undefined}>
                        Échec
                        <button
                          type="button"
                          className="ve-media-retry"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => void retryMediaAction(m.id).then((r) => (r.ok ? router.refresh() : toast(r.message, "error")))}
                        >
                          Réessayer
                        </button>
                      </span>
                    )}
                    </span>
                    <span className="ve-media-name">{m.name}</span>
                    {m.status === "ready" && m.kind !== "pdf" && <ZoomButton onZoom={() => setMediaPreview(m)} />}
                  </li>
                ))}
              </ul>
            )}
            {mediaPage.more && <div ref={mediaSentinel} className="ve-media-more" aria-hidden="true" data-testid="ve-media-more" />}
            <p className="ve-hint">
              Clique une vignette pour la poser dans l&apos;image, la vidéo ou la grille sélectionnée (la petite loupe l&apos;agrandit sans la poser), ou glisse-la sur un
              projet de la page : entre deux images, ou sur une place vide. Tu peux aussi déposer des fichiers de ton ordinateur directement sur le projet.
            </p>
          </>
        )}

        {tab === "structure" &&
          (blocks.length === 0 ? (
            <p className="ve-empty">La page est vide. Ajoute un premier bloc depuis « Ajouter ».</p>
          ) : (
            <StructureTree
              blocks={blocks}
              byType={byType}
              selected={selected}
              invalid={errorUids}
              onSelect={(uid) => selectBlock(uid, { scroll: true })}
              onMove={moveTree}
              onOp={op}
            />
          ))}

        {tab === "reglages" &&
          (itemSel ? (
            <BoardItemPanel
              type={itemSel.type}
              uid={itemSel.uid}
              props={itemSel.props}
              box={itemSel.box}
              onChange={(props) => itemChange({ props })}
              onBox={(box) => itemChange({ box })}
              onConvert={(to) => void convertItem(itemSel.board, itemSel.uid, to)}
              context={editorContext}
              editor={own(editors, itemSel.type)}
              head={
                <div className="ve-settings-tools" role="group" aria-label="Bloc du projet">
                  <button type="button" className="a-icon-btn" aria-label="Monter" onClick={() => void itemOp(itemSel.board, itemSel.uid, "up")}>
                    ↑
                  </button>
                  <button type="button" className="a-icon-btn" aria-label="Descendre" onClick={() => void itemOp(itemSel.board, itemSel.uid, "down")}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="a-icon-btn a-danger-text"
                    aria-label="Supprimer"
                    onClick={() => {
                      const { board, uid } = itemSel;
                      setItemSel(null);
                      void itemOp(board, uid, "remove");
                    }}
                  >
                    ✕
                  </button>
                </div>
              }
            />
          ) : selected === "site-header" || selected === "site-footer" ? (
            <>
            <SiteEditor
              which={selected === "site-header" ? "header" : "footer"}
              snap={siteSnap}
              pages={pages}
             
              onChange={(change) =>
                void writeSite((cur) => {
                  const next = JSON.parse(JSON.stringify(cur)) as SiteSnap;
                  change(next);
                  return SiteSnapSchema.safeParse(next).success ? next : null;
                })
              }
            />
            {selected === "site-header" && (
              <StrokeField
                title="Couleur du soulignement"
                help="Le trait sous le lien de la page courante et au survol. Sans réglage : la couleur du site pour le trait, sinon celle du thème."
                value={siteSnap.styles?.stroke?.header}
                testid="header-stroke"
                onChange={(t) => void applySiteStyles((cur) => ({ ...(cur ?? {}), stroke: { ...(cur?.stroke ?? {}), header: t } }), [])}
              />
            )}
            {selected === "site-header" && <LogoPanel value={liveLook.logo} onChange={(l) => requestLook(liveLook.palette, l)} media={context.media} signature={lookContext.signature} onChooseImage={() => setLogoPick(true)} />}
            </>
          ) : selBlock && selDef ? (
            <div className="ve-settings">
              {selChain.length > 0 && (
                <nav className="ve-crumbs" aria-label="Emplacement du bloc">
                  {selChain.map((c) => (
                    <span key={c.uid}>
                      <button type="button" className="ve-crumb" onClick={() => selectBlock(c.uid, { scroll: true })}>
                        {own(byType, c.type)?.label ?? c.type}
                      </button>
                      <span aria-hidden="true"> › </span>
                    </span>
                  ))}
                  <span aria-current="true">{selDef.label}</span>
                </nav>
              )}
              <header className="ve-settings-head">
                <h2>{selDef.label}</h2>
                <div className="ve-settings-tools" role="group" aria-label="Bloc sélectionné">
                  <button type="button" className="a-icon-btn" aria-label="Monter" disabled={selAt?.index === 0} onClick={() => op("up", selBlock.uid)}>
                    ↑
                  </button>
                  <button type="button" className="a-icon-btn" aria-label="Descendre" disabled={selAt?.index === selSiblings.length - 1} onClick={() => op("down", selBlock.uid)}>
                    ↓
                  </button>
                  {selAt?.parent && (
                    <button type="button" className="a-icon-btn" aria-label="Sortir du bloc" title="Sortir du bloc" onClick={() => op("out", selBlock.uid)}>
                      ⇱
                    </button>
                  )}
                  <button type="button" className="a-icon-btn" aria-label="Dupliquer" disabled={Boolean(selDef.locked)} title={selDef.locked ? "Ce bloc existe une seule fois sur la page." : undefined} onClick={() => op("duplicate", selBlock.uid)}>
                    ⧉
                  </button>
                  <button type="button" className="a-icon-btn a-danger-text" aria-label="Supprimer" disabled={Boolean(selDef.locked)} title={selDef.locked} data-locked={selDef.locked ? "" : undefined} onClick={() => op("delete", selBlock.uid)}>
                    ✕
                  </button>
                </div>
              </header>
              <p className="ve-hint">{selDef.description}</p>
              {selDef.inline.length > 0 && <p className="ve-hint">Les textes se modifient aussi directement sur la page : double-clic (ou double-tap) dessus.</p>}
              {selPath && publishErrors[selPath] && <p className="a-field-error">{publishErrors[selPath]}</p>}
              {selBlock.type === "image" && !(selAt?.parent && findBlock(blocks, selAt.parent)?.type === "grid") && (
                <ImageSizeSection key={`size-${selBlock.uid}`} look={readLook(selBlock.props.look) ?? {}} onChange={(next) => void applyLook(selBlock.uid, next)} />
              )}
              {selBlock.type === "image" && (
                // Haut du panneau (lot 41) : le fond derrière l'image, comme dans la barre de l'image sur la toile (look.imageBg).
                <section className="lp lp-image-bg tc" aria-label="Fond de l'image" data-testid="panel-imgbg">
                  <ImageBgControls
                    value={readLook(selBlock.props.look)?.imageBg}
                    onChange={(imageBg) => void mediaLook({ kind: "media-look", target: { kind: "block", uid: selBlock.uid }, patch: { bg: imageBg ?? null } })}
                    swatch={(c) => swatches[c]}
                  />
                </section>
              )}
              {editor ? (
                <BlockEditorContext.Provider
                  value={{
                    value: selBlock.props,
                    onChange: (props) => {
                      const uid = selBlock.uid;
                      setBlocks(
                        updateBlock(draftRef.current.blocks, uid, (x) => ({ ...x, props })),
                        { key: `props:${uid}` },
                      );
                    },
                    errors: blockErrors(publishErrors, selPath),
                    context: editorContext,
                    idPrefix: `ve-${selBlock.uid}`,
                  }}
                >
                  {editor}
                </BlockEditorContext.Provider>
              ) : (
                <p className="ve-empty">
                  {selDef.inline.length > 0
                    ? "Ce bloc n'a pas de réglage à part : ses textes se modifient directement sur la page (double-clic ou double-tap dessus). Sa mise en page se règle ci-dessous."
                    : "Ce bloc n'a pas de réglage à part : il s'affiche tel quel. Sa mise en page (espaces) se règle ci-dessous ; tu peux aussi le déplacer, le dupliquer ou le supprimer avec les boutons ci-dessus."}
                </p>
              )}
              <BlockLookPanel
                key={selBlock.uid}
                type={selBlock.type}
                look={readLook(selBlock.props.look) ?? {}}
                inCell={Boolean(selAt?.parent && findBlock(blocks, selAt.parent)?.type === "grid")}
                onChange={(next) => void applyLook(selBlock.uid, next)}
              />
            </div>
          ) : (
            <div className="ve-settings-empty">
              <p>Clique sur un bloc de la page pour le régler. Les textes se modifient directement sur la page.</p>
              <p className="ve-hint">
                Titre, adresses et référencement de la page : <Link href={`/admin/pages/${pageId}`} onClick={(e) => void leaveTo(e, `/admin/pages/${pageId}`)}>formulaire de la page</Link>.
              </p>
              <div className="ve-page-collection">
                <PageCollectionField
                  value={draft.collection}
                  onChange={(v) => apply({ ...draftRef.current, collection: v }, { structural: true })}
                  pages={context.pages}
                  pageId={pageId}
                  error={publishErrors.collection}
                />
                <PageButtonsColorField
                  value={draft.accent ?? null}
                  onChange={(v) => apply({ ...draftRef.current, accent: v }, { structural: true })}
                  colors={effective}
                  error={publishErrors.accent}
                />
                <PageWallpaperField value={draft.wallpaper ?? null} onChange={(v) => apply({ ...draftRef.current, wallpaper: v }, { structural: true })} choices={context.wallpapers ?? []} />
              </div>
              <ColorsPanel theme={lookContext.theme} preparing={lookContext.preparing !== null} value={liveLook.palette} onChange={(p) => requestLook(p, liveLook.logo)} onHighlight={highlightRole} info={hlInfo} />
              <LogoPanel value={liveLook.logo} onChange={(l) => requestLook(liveLook.palette, l)} media={context.media} signature={lookContext.signature} onChooseImage={() => setLogoPick(true)} />
              <StrokeField
                title="Couleur du trait (tout le site)"
                help="Le trait dessiné du thème : barre de défilement des images qui défilent, filets, soulignement du menu. Une couleur et une opacité se mélangent au dessin d'origine. Chaque rangée d'images et l'en-tête peuvent avoir la leur."
                value={siteSnap.styles?.stroke?.all}
                testid="site-stroke"
                onChange={(t) => void applySiteStyles((cur) => ({ ...(cur ?? {}), stroke: { ...(cur?.stroke ?? {}), all: t } }), [])}
              />
              <SiteStylesPanel styles={siteSnap.styles} onChange={(s) => void applySiteStyles(() => s, Object.values(cleanSiteStyles(s)?.roles ?? {}))} palette={swatches} cardPalette={effective} installed={fontFamilies} />
            </div>
          ))}
      </div>
    </aside>
  );

  return (
    <div className="ve" data-mode={mode} data-mobile={mobile || undefined} data-modal={canvasModal || undefined}>
      {canvasModal && mode === "edit" && <div className="ve-veil" data-testid="ve-veil" aria-hidden="true" />}
      {mode === "edit" && lookContext.preparing && <PreparingBanner preparing={lookContext.preparing} flush={flush} />}
      {mode === "edit" && (
        <header className="ve-top" inert={canvasModal || undefined}>
          <Link href="/admin/pages" className="ve-brand" title="Retour aux pages" onClick={(e) => void leaveTo(e, "/admin/pages")}>
            <span aria-hidden="true">←</span>
            <span className="ve-brand-text">
              {siteName}
              <small>éditeur de page</small>
            </span>
          </Link>
          <label className="ve-page">
            <span className="sr-only">Page</span>
            <select className="a-input" value={pageId} onChange={(e) => void goToPage(Number(e.target.value))}>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          {themeChoices.length > 0 && <ThemePicker themes={themeChoices} preparing={lookContext.preparing} flush={flush} />}
          <div className="a-seg ve-seg" role="group" aria-label="Langue">
            {(["fr", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                lang={l}
                onClick={() => {
                  if (l === locale) return;
                  // Retient le bloc visible dans la toile (ou rien : la toile est ouverte sur une page sans équivalent).
                  try {
                    const win = frameRef.current?.contentWindow;
                    langSnap.current = win ? takeSnap(win) : null;
                  } catch {
                    langSnap.current = null;
                  }
                  setFrameReady(false);
                  setLocale(l);
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="ve-break" aria-hidden="true" />
          {!mobile && topTighter && (
            // Peu de place (jusqu'à 1180 px) : un seul menu déroulant, toujours dans la barre (jamais caché derrière « … »).
            <label className="ve-device-select">
              <span className="sr-only">Largeur d&apos;aperçu</span>
              <select className="a-input" aria-label="Largeur d'aperçu" value={device} onChange={(e) => setDevice(e.target.value as Device)}>
                {DEVICES.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.width} px)
                  </option>
                ))}
              </select>
            </label>
          )}
          {!mobile && !topTighter && (
            <div className="a-seg ve-seg" role="group" aria-label="Largeur d'aperçu">
              {DEVICES.map((d) => (
                <button key={d.id} type="button" aria-pressed={device === d.id} onClick={() => setDevice(d.id)} title={`${d.label} (${d.width} px)`}>
                  {d.label}
                </button>
              ))}
            </div>
          )}
          <span className="ve-spacer" />
          <div className="ve-history" role="group" aria-label="Historique">
            <button type="button" className="a-icon-btn" onClick={undo} disabled={!historyLen.past} aria-label="Défaire" title="Défaire la dernière action (Ctrl+Z)">
              ↶
            </button>
            <button type="button" className="a-icon-btn" onClick={redo} disabled={!historyLen.future} aria-label="Rétablir" title="Rétablir (Ctrl+Maj+Z)">
              ↷
            </button>
          </div>
          <span className="ve-status" data-tone={status.tone} role="status" aria-live="polite">
            <span className="ve-dot" aria-hidden="true" />
            {status.text}
            {status.reason && (
              <span className="ve-status-reason" title={status.reason}>
                {" "}· {status.reason}
              </span>
            )}
            {saveState === "error" && !blocked && (
              <button type="button" className="a-btn a-btn-small" onClick={() => void flush()} title={saveError ?? undefined}>
                Réessayer
              </button>
            )}
          </span>
          {/* En erreur, la place va à la raison et à « Réessayer ». */}
          {hasDraft && !mobile && !topTight && !blocked && saveState !== "error" && (
            <button type="button" className="a-btn a-btn-quiet ve-discard" onClick={() => setDiscarding(true)}>
              Abandonner les modifications
            </button>
          )}
          {!mobile && topTight && (
            <TopMore
              onDiscard={hasDraft && !blocked && saveState !== "error" ? () => setDiscarding(true) : undefined}
            />
          )}
          <button type="button" className="a-btn" onClick={() => setMode("preview")} disabled={foreign}>
            Aperçu
          </button>
          <button
            type="button"
            className="a-btn a-btn-primary"
            onClick={() => (draft.published ? void publish() : setAskLive(true))}
            disabled={publishing || Boolean(blocked) || (!hasDraft && !sitePending && saveState === "idle" && draft.published)}
            title={!draft.published ? "Met le contenu et la page en ligne" : !hasDraft && !sitePending && saveState === "idle" ? "Aucune modification à publier" : undefined}
          >
            {publishing ? "Publication…" : "Publier"}
          </button>
        </header>
      )}

      <div className="ve-body">
        {mode === "edit" && panel}
        <main ref={canvasRef} className="ve-canvas" data-device={mobile ? "phone" : device}>
          {(publishMessage || problems.length > 0) && mode === "edit" && (
            <div className="ve-alert ve-problems" role="alert" data-testid="publish-problems">
              <strong>
                {problems.length > 0 ? `Publication impossible : ${problems.length} point${problems.length > 1 ? "s" : ""} à corriger.` : publishMessage}
              </strong>
              {problems.length > 0 && (
                <>
                  <span className="ve-problems-hint">Clique sur une ligne pour aller au bon endroit de la page.</span>
                  <ul className="ve-problems-list">
                    {problems.map((p) => (
                      <li key={p.key}>
                        {p.kind === "form" ? (
                          <Link href={`/admin/pages/${pageId}`} className="ve-problem" onClick={(e) => void leaveTo(e, `/admin/pages/${pageId}`)}>
                            <span className="ve-problem-where">{p.field ?? p.where}</span>
                            <span className="ve-problem-msg">{p.message} Ouvrir le formulaire de la page.</span>
                          </Link>
                        ) : (
                          <button type="button" className="ve-problem" onClick={() => goToProblem(p)}>
                            <span className="ve-problem-where">{p.field && p.kind === "block" ? `${p.where} · ${p.field}` : (p.field ?? p.where)}</span>
                            <span className="ve-problem-msg">{p.message}</span>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {publishWarn && mode === "edit" && (
            <div className="ve-alert ve-warnings" role="status" data-testid="publish-warnings">
              <strong>
                C&apos;est publié. {[publishWarn.missingAlt.length > 0, publishWarn.untranslated > 0, publishWarn.notInMenu].filter(Boolean).length > 1 ? "Quelques points à regarder" : "Une chose à regarder"}, rien ne bloque :
              </strong>
              <ul className="ve-problems-list">
                {publishWarn.notInMenu && (
                  <li data-testid="warn-menu">
                    Cette page est en ligne mais n&apos;apparaît dans aucun menu : les visiteurs ne la trouveront pas.{" "}
                    <button type="button" className="a-btn a-btn-small" onClick={() => void addToMenu()}>
                      Ajouter au menu
                    </button>
                  </li>
                )}
                {publishWarn.missingAlt.length > 0 && (
                  <li data-testid="warn-alt">
                    {publishWarn.missingAlt.length} image{publishWarn.missingAlt.length > 1 ? "s" : ""} sans description (pour les personnes malvoyantes et Google) :{" "}
                    <span className="muted">{publishWarn.missingAlt.slice(0, 5).map((m) => m.name).join(", ")}{publishWarn.missingAlt.length > 5 ? "…" : ""}</span>{" "}
                    <Link href={`/admin/medias?filtre=sans-description&media=${publishWarn.missingAlt[0].id}`} onClick={(e) => void leaveTo(e, `/admin/medias?filtre=sans-description&media=${publishWarn.missingAlt[0].id}`)}>
                      Compléter les descriptions
                    </Link>
                  </li>
                )}
                {publishWarn.untranslated > 0 && (
                  <li data-testid="warn-translation">
                    {untranslatedLabel(publishWarn.untranslated)}. Les visiteurs anglophones verront ces passages vides ou en français : remplis les champs « EN » dans l&apos;éditeur.
                  </li>
                )}
              </ul>
              <div className="ve-alert-actions">
                <button type="button" className="a-btn a-btn-small" onClick={() => setPublishWarn(null)}>
                  Fermer
                </button>
              </div>
            </div>
          )}
          {blocked === "conflict" && mode === "edit" && (
            <div className="ve-alert ve-alert-strong" role="alert" data-testid="conflict">
              <p>
                <strong>Cette page a été modifiée ailleurs</strong> (autre onglet, formulaire ou publication ; même chose si ce sont les changements du site, communs à toutes les pages). Tes dernières modifications
                ne sont pas enregistrées : rien n&apos;a été écrasé.
              </p>
              <div className="ve-alert-actions">
                <button type="button" className="a-btn a-btn-small" onClick={() => void copyTexts()}>
                  Copier mes textes
                </button>
                <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => window.location.reload()}>
                  Recharger
                </button>
              </div>
              <details className="ve-alert-texts">
                <summary>Voir mes textes en cours</summary>
                <textarea readOnly value={draftTexts(draft, byType)} rows={6} aria-label="Mes textes en cours" />
              </details>
            </div>
          )}
          {blocked === "corrupt" && mode === "edit" && (
            <div className="ve-alert ve-alert-strong" role="alert" data-testid="corrupt">
              <p>
                <strong>Ce brouillon ne peut plus être lu</strong> (un bloc a changé). La toile montre ce qui en reste ; rien ne
                sera enregistré ni publié avant ton choix.
              </p>
              <div className="ve-alert-actions">
                <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setResetting(true)}>
                  Repartir de la version publiée
                </button>
              </div>
            </div>
          )}
          {sitePending && mode === "edit" && (
            <div className="ve-site-chip" role="note">
              <strong>En-tête modifié</strong> (nom, menu, pied de page ou réseaux) : à la publication de cette page, il change sur <strong>toutes les pages</strong>.{" "}
              <button type="button" className="a-btn a-btn-small" data-testid="site-discard" onClick={() => setDiscardingSite(true)}>
                Annuler ces changements du site
              </button>
            </div>
          )}
          {foreign && mode === "edit" && (
            <div className="ve-alert" role="status">
              La toile affiche une autre page.{" "}
              <button type="button" className="a-btn a-btn-small" onClick={() => frameRef.current && (frameRef.current.src = frameSrc)}>
                Revenir à cette page
              </button>
            </div>
          )}
          {wide && (
            <p className="ve-zoom-note" data-testid="zoom-note">
              Grand écran : {WIDE_PX} px de large, affiché à {Math.round(zoom * 100)} %
            </p>
          )}
          <div
            ref={wrapRef}
            className="ve-frame-wrap"
            data-wide={wide || undefined}
            style={wide ? { width: Math.round(WIDE_PX * zoom), maxWidth: "none", flex: "1 1 0" } : { maxWidth: mode === "preview" && device === "desktop" ? undefined : (frameWidth ?? undefined) }}
          >
            {!frameReady && <div className="ve-loading">Chargement de la page…</div>}
            <iframe
              key={locale}
              ref={frameRef}
              className="ve-frame"
              onLoad={restoreLangScroll}
              style={wide ? { position: "absolute", top: 0, left: 0, width: WIDE_PX, height: Math.round(box.h / zoom), transform: `scale(${zoom})`, transformOrigin: "0 0" } : undefined}
              src={frameSrc}
              title={mode === "preview" ? "Aperçu de la page" : "Page en cours d'édition"}
            />
            {paletteDrag && <div className="ve-dragcover" aria-hidden="true" />}
          </div>
        </main>
      </div>

      {paletteDrag && (
        <div className="ve-ghost" data-over={paletteDrag.over || undefined} style={{ transform: `translate(${paletteDrag.x + 12}px, ${paletteDrag.y + 12}px)` }} aria-hidden="true">
          <BlockThumb type={paletteDrag.type} />
          {paletteDrag.label}
          {paletteDrag.over && dropIndex !== null && <small>Position {dropIndex + 1}</small>}
        </div>
      )}

      {mediaDrag && (
        <div className="ve-ghost" data-over={mediaDrag.over || undefined} style={{ transform: `translate(${mediaDrag.x + 12}px, ${mediaDrag.y + 12}px)` }} aria-hidden="true">
          {mediaDrag.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaDrag.thumb} alt="" className="ve-ghost-thumb" />
          )}
          {mediaDrag.label}
        </div>
      )}

      <MediaPickerDialog
        open={picker !== null}
        media={context.media.filter((m) => m.kind !== "pdf")}
        onClose={() => setPicker(null)}
        onPick={(mediaId) => {
          const p = picker;
          setPicker(null);
          if (p) void boardDo(p.board, slotBoardOp(p.key, { op: "fill", mediaId }));
        }}
        onFile={(file) => {
          const p = picker;
          setPicker(null);
          if (p) void uploadFiles({ kind: "slot", board: p.board, key: p.key }, [file]);
        }}
      />

      <MediaPickerDialog
        open={addPicker !== null}
        media={context.media.filter((m) => m.kind !== "pdf")}
        onClose={() => setAddPicker(null)}
        onPick={(mediaId) => {
          const p = addPicker;
          setAddPicker(null);
          if (p) void boardDo(p.board, { op: "add", mediaId, index: 0, end: true });
        }}
        onFile={(file) => {
          const p = addPicker;
          setAddPicker(null);
          if (p) void uploadFiles({ kind: "board", board: p.board, index: 0 }, [file]);
        }}
      />

      {mode === "preview" && (
        <button type="button" className="ve-exit-preview" onClick={() => setMode("edit")}>
          Quitter l&apos;aperçu <kbd>Échap</kbd>
        </button>
      )}

      {mobile && mode === "edit" && !sheet && (
        <button type="button" className="ve-fab" aria-expanded={false} onClick={() => setSheet(true)}>
          ＋ Composants
        </button>
      )}
      {mobile && sheet && mode === "edit" && <div className="ve-scrim" onClick={() => setSheet(false)} aria-hidden="true" />}

      <ConfirmDialog
        open={deleting !== null}
        title={`Supprimer le bloc « ${deletingBlock ? (own(byType, deletingBlock.type)?.label ?? "") : ""} » ?`}
        confirmLabel={deletingCount ? `Supprimer avec ses ${deletingCount} bloc${deletingCount > 1 ? "s" : ""}` : "Supprimer le bloc"}
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      >
        {deletingCount > 0 && (
          <p data-testid="delete-count">
            <strong>
              {deletingCount} bloc{deletingCount > 1 ? "s" : ""} {deletingCount > 1 ? "seront retirés" : "sera retiré"} avec lui.
            </strong>
          </p>
        )}
        {deletingLost.length > 0 && <p>Les changements d&apos;images {deletingLost.length > 1 ? "de ses projets" : "de son projet"} ne seront pas publiés (les images en ligne ne bougent pas).</p>}
        <p className="muted">Il disparaît du brouillon ; « Défaire » (Ctrl+Z) le récupère. Le site ne change qu&apos;à la publication.</p>
      </ConfirmDialog>

      <AddSectionDialog
        open={adding !== null}
        catalog={catalog}
        present={present}
        where={
          adding === null
            ? ""
            : adding.parent
              ? `Dans « ${own(byType, findBlock(blocks, adding.parent)?.type ?? "")?.label ?? "le bloc"} »`
              : adding.index >= blocks.length
                ? "À la fin de la page"
                : adding.index === 0
                  ? "En tête de page"
                  : "Entre deux blocs"
        }
        onClose={() => setAdding(null)}
        onPick={(choice: AddChoice) => {
          const at = adding;
          setAdding(null);
          if (!at) return;
          if (choice.kind === "starter") insertStarter(choice.starter, at);
          else if (choice.kind === "carousel") void addCarousel(at);
          else insert(choice.key, at);
        }}
      />

      <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />

      <MediaPickerDialog
        open={cellPick !== null}
        kind={cellPick?.kind}
        media={context.media.filter((m) => (cellPick?.kind ? m.kind === cellPick.kind : m.kind !== "pdf"))}
        onClose={() => setCellPick(null)}
        onPick={(mediaId) => {
          const p = cellPick;
          setCellPick(null);
          if (p) void gridPut(p.uid, p.board, p.index, mediaId, p.kind, p.props);
        }}
        onFile={(file) => {
          const p = cellPick;
          setCellPick(null);
          if (!p) return;
          void sendAndWait(file).then((id) => {
            if (id !== null) void gridPut(p.uid, p.board, p.index, id, file.type.startsWith("video/") ? "video" : "image", p.props);
          });
        }}
      />

      <MediaPickerDialog
        open={freePick !== null}
        media={context.media.filter((m) => m.kind === "image" || (m.kind === "video" && !freePick?.poster))}
        onClose={() => setFreePick(null)}
        onPick={(mediaId) => {
          const p = freePick;
          setFreePick(null);
          if (p) void freeChoose(p, mediaId);
        }}
        onFile={(file) => {
          const p = freePick;
          setFreePick(null);
          if (!p) return;
          void sendAndWait(file).then((id) => {
            if (id !== null) void freeChoose(p, id, file.type.startsWith("video/") ? "video" : "image");
          });
        }}
      />

      <MediaPickerDialog
        open={tileCover !== null}
        media={context.media.filter((m) => m.kind === "image")}
        onClose={() => setTileCover(null)}
        onPick={(mediaId) => {
          const t = tileCover;
          setTileCover(null);
          if (t) applyTileCover(t, mediaId);
        }}
        onFile={(file) => {
          const t = tileCover;
          setTileCover(null);
          if (t) void sendAndWait(file).then((id) => id !== null && applyTileCover(t, id));
        }}
      />

      <MediaPickerDialog
        open={logoPick}
        media={context.media.filter((m) => m.kind === "image")}
        onClose={() => setLogoPick(false)}
        onPick={(mediaId) => {
          setLogoPick(false);
          requestLook(liveLook.palette, { ...liveLook.logo, mediaId });
        }}
        onFile={(file) => {
          setLogoPick(false);
          void sendAndWait(file).then((id) => {
            if (id !== null) requestLook(liveLook.palette, { ...liveLook.logo, mediaId: id });
          });
        }}
      />

      <MediaPickerDialog
        open={mediaPick !== null}
        kind={mediaPick?.kind === "video" ? "video" : mediaPick?.kind === "image" ? "image" : undefined}
        media={mediaPick && mediaPick.kind !== "any" ? context.media.filter((m) => m.kind === mediaPick.kind) : context.media.filter((m) => m.kind !== "pdf")}
        onClose={() => setMediaPick(null)}
        onPick={(mediaId) => {
          const p = mediaPick;
          setMediaPick(null);
          if (p) placeMedia({ kind: "media", uid: p.uid, field: p.field }, mediaId);
        }}
        onFile={(file) => {
          const p = mediaPick;
          setMediaPick(null);
          if (p) void uploadToBlock({ kind: "media", uid: p.uid, field: p.field }, [file]);
        }}
      />

      <ConfirmDialog
        open={askLive}
        title="Mettre cette page en ligne ?"
        confirmLabel="Mettre en ligne"
        busy={publishing}
        onClose={() => setAskLive(false)}
        onConfirm={() => void publish(true)}
      >
        <p className="muted">Elle sera visible par tous. Tu pourras la retirer du site à tout moment, depuis la liste des pages.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={discardingSite}
        title="Annuler les changements du site ?"
        confirmLabel="Annuler ces changements du site"
        danger
        busy={discardSiteBusy}
        onClose={() => setDiscardingSite(false)}
        onConfirm={() => void discardSite()}
      >
        <p className="muted">
          Le nom, le menu, le pied de page, les réseaux, les styles et le logo reviennent à ce qui est en ligne, sur toutes les pages. Les modifications des pages ne changent pas. Cette action ne s&apos;annule pas.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={resetting}
        title="Repartir de la version publiée ?"
        confirmLabel="Repartir de la version publiée"
        danger
        busy={discardBusy}
        onClose={() => setResetting(false)}
        onConfirm={() => void discard()}
      >
        <p className="muted">Le brouillon illisible est effacé ; la page en ligne ne change pas.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={discarding}
        title="Abandonner les modifications ?"
        confirmLabel="Abandonner les modifications"
        danger
        busy={discardBusy}
        onClose={() => setDiscarding(false)}
        onConfirm={() => void discard()}
      >
        <p className="muted">Le brouillon est effacé et la page revient à sa version en ligne. Cette action ne s&apos;annule pas.</p>
      </ConfirmDialog>

      <p className="sr-only" aria-live="polite">
        {canvasBlocks.length ? `${canvasBlocks.length} blocs sur la toile` : ""}
      </p>
    </div>
  );
}
