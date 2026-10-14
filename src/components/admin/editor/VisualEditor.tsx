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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  boardAction,
  createDraftProjectAction,
  discardDraftAction,
  installFontAction,
  publishDraftAction,
  restoreBoardAction,
  saveDraftAction,
  siteDraftAction,
} from "@/app/admin/(espace)/pages/actions";
import { PageCollectionField } from "@/app/admin/_fields";
import { BlockEditorContext } from "@/blocks/editor-context";
import { pickerGroups } from "@/blocks/groups";
import { HELP_TEXT, STARTER_LIST, TEXT_STARTERS, type TextStarter } from "@/blocks/help-text";
import type { BlockCatalogEntry, EditorContext } from "@/blocks/editor-types";
import { blockAtPath, boardRefs, canPlace, descendantCount, errorPath, findBlock, insertBlock, isContainer, listOf, locate, moveBlock, removeBlock, updateBlock, walk as walkTree, withFreshUids } from "@/blocks/tree";
import { makeField, MAX_FIELDS, type FormField } from "@/lib/contact-form";
import { SiteSnapSchema, type SiteSnap } from "@/lib/site-schema";
import type { BoardOp, BoardResult, BoardSnap } from "@/lib/edit/boards";
import type { DraftBlock, PageDraft } from "@/lib/edit/drafts";
import { mediaStatusAction, retryMediaAction } from "@/app/admin/(espace)/medias/actions";
import type { AdminMediaRow } from "@/lib/admin";
import { acceptFromCanvas, EDIT_MSG, inlineAllowed, setLocalizedAt, type BlockInfo, type DropTargetInfo, type FromCanvas, type Ghost, type ToCanvas } from "@/lib/edit/protocol";
import { markedProblem } from "@/lib/marked";
import { own } from "@/lib/own";
import { hasFace, type FontLibrary } from "@/lib/fonts/faces";
import type { LookContext } from "@/lib/edit/look-context";
import { cleanLook, cleanSiteStyles, googleOf, readLook, type Logo, type Look, type Role, type SitePalette, type SiteStyles, type TextStyle } from "@/lib/look";
import { googleFamily, nearestWeight } from "@/themes/google-fonts";
import { cleanSurface, readSurface, type Surface } from "@/themes/surface";
import { effectiveSitePalette } from "@/themes/site-palette";

import { clone, ConfirmDialog, toast, useUnsavedGuard } from "../editing";
import { filterMedia } from "../LibraryStrip";
import Uploader from "../Uploader";
import { isUploaded, useUploadQueue } from "../UploadQueue";
import { isPdfFile, readRatio, sendFile, useMediaWatch } from "../uploads";
import AddSectionDialog, { type AddChoice } from "./AddSectionDialog";
import { BlockLookPanel, SiteStylesPanel } from "./LookPanel";
import { ColorsPanel, LogoPanel, type HighlightInfo } from "./SiteLookPanel";
import MediaPickerDialog from "./MediaPickerDialog";
import SiteEditor, { applySiteOp, siteText } from "./SiteEditor";
import StructureTree from "./StructureTree";
import BlockThumb from "./thumbs";

type Locale = "fr" | "en";
type Device = "desktop" | "tablet" | "phone";
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
const CANVAS_INTENTS = new Set<string>(["text", "site-text", "site-op", "form-field", "look", "site-style", "site-look", "op", "move", "layout", "tile-size", "tile-op", "slot-text", "project-text", "surface"]);
/** Fantôme d'envoi : ce que la toile affiche, plus le fichier et le média côté éditeur. */
type GhostItem = Ghost & { batch: string; file?: File; mediaId?: number; collection?: "characters" | "backgrounds" | "animation" };
/** Ce qui part vers la toile (ni fichier, ni identifiants internes). */
const toWire = (g: GhostItem): Ghost => ({
  id: g.id,
  board: g.board,
  ...(g.index !== undefined ? { index: g.index } : {}),
  ...(g.slot ? { slot: g.slot } : {}),
  label: g.label,
  ...(g.preview ? { preview: g.preview } : {}),
  aspect: g.aspect,
  progress: g.progress,
  phase: g.phase,
  ...(g.message ? { message: g.message.slice(0, 300) } : {}),
  ...(g.key ? { key: g.key } : {}),
});

const DEVICES: { id: Device; label: string; width: number | null }[] = [
  { id: "desktop", label: "Ordinateur", width: 1180 },
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
  site: { snap: SiteSnap; pending: boolean; lockedBy: string | null };
  /** Mise en page (lot 2) : palette du thème, polices déjà téléchargées. */
  look: LookContext;
}) {
  const router = useRouter();
  const mobile = useMedia(MOBILE);
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
  const [publishing, setPublishing] = useState(false);

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
  const [frameReady, setFrameReady] = useState(false);
  const [foreign, setForeign] = useState(false);
  const [canvasBlocks, setCanvasBlocks] = useState<BlockInfo[]>([]);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dropRefused, setDropRefused] = useState(false);
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
        result = { ok: false, message: "connexion perdue" };
      } finally {
        inFlight.current = false;
      }
      if (!result.ok) {
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
  const flush = useCallback(async (): Promise<boolean> => {
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
  const siteLocked = initialSite.lockedBy;
  // Défini plus bas (après runSave) ; appelé par l'historique.
  const writeSiteRef = useRef<(next: SiteSnap | SiteUpdate, record?: boolean) => Promise<boolean>>(async () => false);

  /**
   * Écrit sur une planche (opération ou instantané), après le brouillon en
   * attente. Renvoie le résultat, ou null si refusé (message affiché).
   */
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
            result = { ok: false, message: "connexion perdue" };
          }
          if (!result.ok) {
            if ("code" in result) stop(result.code);
            else {
              setSaveState("idle");
              toast(result.message, "error");
            }
            return null;
          }
          revRef.current = result.data.rev;
          boards.current.set(result.data.after.projectId, result.data.after);
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
    [refreshMsg, runSave, send, stop, withLock],
  );

  /**
   * Écrit le brouillon du site (en-tête, pied, réseaux) après le brouillon en
   * attente, avec la version de la page. `record` : inscrit dans l'historique.
   * `next` peut être une fonction : elle est appelée DANS le verrou, sur le dernier état
   * écrit (jamais sur un état antérieur à une écriture encore en vol) ; elle renvoie le
   * nouvel état, `{ error }` (message affiché, rien n'est écrit) ou null (rien à écrire).
   */
  const writeSite = useCallback(
    (next: SiteSnap | SiteUpdate, record = true): Promise<boolean> =>
      withLock(async () => {
        if (blockedRef.current) return false;
        if (siteLocked) {
          toast(`L'en-tête est en cours de modification sur la page « ${siteLocked} » : publie-la ou abandonne-la d'abord.`, "error");
          return false;
        }
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
          result = await siteDraftAction(pageId, snap, revRef.current);
        } catch {
          result = { ok: false, message: "connexion perdue" };
        }
        if (!result.ok) {
          if ("code" in result) stop(result.code);
          else {
            setSaveState("idle");
            toast(result.message, "error");
          }
          return false;
        }
        revRef.current = result.data.rev;
        if (record) {
          history.current = { past: [...history.current.past, { draft: draftRef.current, site: result.data.before }].slice(-HISTORY_MAX), future: [] };
          coalesce.current = null;
          bumpHistory();
        }
        siteRef.current = snap;
        setSiteSnap(snap);
        setSitePending(result.data.pending);
        setHasDraft(true);
        setSaveState("idle");
        setSaveError(null);
        send(refreshMsg(true));
        return true;
      }),
    [pageId, refreshMsg, runSave, send, siteLocked, stop, withLock],
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
      const result = await writeBoard((rev) => boardAction(pageId, projectId, op, rev));
      if (!result) return null;
      // Rien n'a changé (texte identique) : pas de pas d'historique.
      if (JSON.stringify(result.before) === JSON.stringify(result.after)) return result;
      history.current = { past: [...history.current.past, { draft: draftRef.current, board: { projectId, snap: result.before } }].slice(-HISTORY_MAX), future: [] };
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
      send({ kind: "pending", label: "Annulation en cours…" });
      const back = await travel(entry);
      if (!back) {
        toast("Annulation impossible pour ce pas : la planche a changé (image supprimée ?).", "error");
        return;
      }
      const h = history.current;
      history.current = { past: h.past.filter((e) => e !== entry), future: [back, ...h.future] };
      bumpHistory();
      toast("Annulé");
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
        toast("Rétablissement impossible pour ce pas : la planche a changé (image supprimée ?).", "error");
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
    const place = at ?? defaultPlace(def.type);
    if (place.parent === null && list.length >= 40) {
      toast("40 blocs au plus par page.", "error");
      return;
    }
    // Premier Titre d'une page sans titre principal (ni ouverture, qui porte le sien) : il l'est (h1) ; un titre de section sinon (lot 22).
    const principal =
      def.type === "section-title" && place.parent === null && !list.some((b) => b.type === "hero" || b.type === "profile" || (b.type === "section-title" && b.props.main === true));
    const block = withFreshUids({ uid: "", type: def.type, props: clone({ ...def.defaults, ...(principal ? { main: true } : {}), ...opts?.props }) } as DraftBlock, newUid);
    const next = insertBlock(list, block, place.parent, place.index);
    if (!next) {
      const parent = place.parent ? findBlock(list, place.parent) : null;
      toast(parent ? `« ${own(byType, parent.type)?.label ?? "Ce conteneur"} » n'accepte pas « ${def.label} » (ou il est plein).` : "Impossible d'ajouter ce composant ici.", "error");
      return;
    }
    setBlocks(next);
    selectBlock(block.uid, { scroll: true });
    // Rubrique Texte neuve : la toile ouvre l'édition en place, son texte d'aide sélectionné.
    if (opts?.edit) send({ kind: "edit-text", uid: block.uid, path: opts.edit });
    toast(`« ${def.label} » ajouté${place.parent ? ` dans « ${own(byType, findBlock(list, place.parent)?.type ?? "")?.label ?? "le conteneur"} »` : ""}`);
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
  const tileOp = (msg: { uid: string; op: "add" | "remove" | "up" | "down"; index?: number; pageId?: number }): boolean => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, msg.uid);
    if (!block || block.type !== "collection-tiles" || block.props.mode === "auto") return false;
    const items = [...((block.props.items as { pageId?: number }[] | undefined) ?? [])];
    if (msg.op === "add") {
      const page = context.collectionPages?.find((p) => p.pageId === msg.pageId);
      if (!page || items.length >= 24 || items.some((i) => i.pageId === page.pageId)) return false;
      items.push({ collection: page.collection, pageId: page.pageId, eyebrow: page.eyebrow, title: page.title, intro: page.intro } as (typeof items)[number]);
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

  /** Demande de la toile : choix illustré, ou texte tout de suite, à cet endroit. */
  const requestInsert = (parent: string | null, index: number, what: "choose" | TextStarter) => {
    if (what === "choose") setAdding({ parent, index });
    else insertStarter(what, { parent, index });
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

  const op = (kind: "up" | "down" | "duplicate" | "delete" | "out" | "in", uid: string) => {
    const list = draftRef.current.blocks;
    const at = locate(list, uid);
    if (!at) return;
    const siblings = listOf(list, at.parent) ?? [];
    const i = at.index;
    const move = (parent: string | null, index: number, done?: string) => {
      const next = moveBlock(list, uid, parent, index);
      if (!next) {
        toast("Ce composant ne peut pas aller là.", "error");
        return;
      }
      setBlocks(next);
      if (done) toast(done);
    };
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
      move(outer.parent, outer.index + 1, "Sorti du conteneur");
    }
    if (kind === "in") {
      // Entrer dans le conteneur voisin (après, sinon avant) qui l'accepte.
      const block = siblings[i];
      const next = siblings[i + 1];
      const prev = siblings[i - 1];
      const target = [next, prev].find((c) => c && isContainer(c.type) && canPlace(removeBlock(list, uid), block, c.uid));
      if (!target) {
        toast("Aucun conteneur voisin n'accepte ce composant.", "error");
        return;
      }
      const index = target === next ? 0 : (listOf(list, target.uid)?.length ?? 0);
      move(target.uid, index, `Placé dans « ${own(byType, target.type)?.label ?? "le conteneur"} »`);
    }
    if (kind === "duplicate") {
      if (at.parent === null && list.length >= 40) {
        toast("40 blocs au plus par page.", "error");
        return;
      }
      const copy = withFreshUids(clone(siblings[i]), newUid);
      const next = insertBlock(list, copy, at.parent, i + 1);
      if (!next) {
        toast("Ce conteneur est plein.", "error");
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
      toast(`Bloc supprimé · Les changements d'images de ${lost.length > 1 ? "ces planches" : "cette planche"} ne seront pas publiés`, "success", { label: "Annuler", run: () => void undoRef.current() });
    } else toast("Bloc supprimé · Annuler (Ctrl+Z) pour le récupérer", "success", { label: "Annuler", run: () => void undoRef.current() });
  };

  /** Texte posé en place ; false = refusé (la toile retire son aperçu et rétablit le texte d'origine). */
  const editText = (uid: string, path: string, textLocale: string, value: string): boolean => {
    const list = draftRef.current.blocks;
    const block = findBlock(list, uid);
    const def = block && own(byType, block.type);
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
    if (!next) return toast(parent ? "Ce conteneur n'accepte pas ce composant (ou il est plein)." : "Déplacement impossible.", "error");
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
    if (!block || block.type !== "contact-form") return false;
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
    if (msg.op === "remove") {
      if (fields.length <= 1) return refuse("Un formulaire garde au moins un champ.");
      if (fields[i].reply) return refuse("Ce champ e-mail sert à te répondre : dans le panneau, désactive « Sert à te répondre » (ou choisis un autre champ) avant de le retirer.");
      setProp(msg.uid, "fields", fields.filter((_, j) => j !== i));
      toast("Champ retiré", "success", { label: "Annuler", run: () => void undoRef.current() });
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
  const applyLook = async (uid: string, next: Look | null) => {
    const clean = next ? cleanLook(next) : undefined;
    working.current++;
    try {
      if (!(await ensureFonts(Object.values(clean?.text ?? {})))) {
        send({ kind: "refresh", rev: revRef.current, upTo: -1 });
        return;
      }
      const list = draftRef.current.blocks;
      const block = findBlock(list, uid);
      if (!block) return;
      if (JSON.stringify(readLook(block.props.look) ?? null) === JSON.stringify(clean ?? null)) return;
      setBlocks(
        updateBlock(list, uid, (b) => {
          const props = { ...b.props };
          if (clean) props.look = clean;
          else delete props.look;
          return { ...b, props };
        }),
        { key: `look:${uid}` },
      );
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

  const [extraProjects, setExtraProjects] = useState<{ slug: string; title: string; draft: true }[]>([]);
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
    async (uid: string, name: string): Promise<{ id: number; slug: string } | null> => {
      if (blockedRef.current) return null;
      const result = await createDraftProjectAction(pageId, name);
      if (!result.ok) {
        toast(result.message, "error");
        return null;
      }
      setExtraProjects((list) => [...list, { slug: result.data.slug, title: result.data.title, draft: true }]);
      if (uid) setBoardProject(uid, result.data.slug);
      toast(`Projet « ${result.data.title} » créé : il devient public avec la page`);
      return { id: result.data.id, slug: result.data.slug };
    },
    [pageId, setBoardProject],
  );
  useEffect(() => {
    panelCreate.current = async (name) => (await createProject("", name))?.slug ?? null;
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
      if (!next) return toast("Cette grille n'accepte plus de composant.", "error");
      setBlocks(next);
      selectBlock(child.uid);
      return;
    }
    const field = own(byType, block.type)?.mediaFields?.find((f) => f.field === target.field);
    if (!field) return;
    const expected = { video: "Ce bloc attend une vidéo.", pdf: "Ce bloc attend un PDF.", image: "Ce bloc attend une image.", any: "Ce bloc attend une image ou une vidéo." }[field.kind];
    if (kind && (field.kind === "any" ? kind === "pdf" : kind !== field.kind)) return toast(expected, "error");
    setProp(target.uid, target.field, mediaId);
    toast(field.kind === "video" ? "Vidéo placée" : field.kind === "pdf" ? "PDF placé" : "Image placée", "success", { label: "Annuler", run: () => void undoRef.current() });
  };

  /** Fichiers déposés sur un bloc média ou une place libre : envoyés, convertis, puis posés. */
  const uploadToBlock = async (target: Extract<DropTargetInfo, { kind: "media" | "cell" }>, files: File[]) => {
    for (const file of target.kind === "media" ? files.slice(0, 1) : files) {
      toast(`Envoi de « ${file.name.slice(0, 60)} »…`);
      const up = await sendFile(file, () => undefined);
      if (!up.ok) {
        toast(up.message, "error");
        continue;
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
        continue;
      }
      placeMedia(target, up.media.id, file.type.startsWith("video/") ? "video" : isPdfFile(file) ? "pdf" : "image");
    }
  };

  const [mediaPick, setMediaPick] = useState<{ uid: string; field: "mediaId" | "backgroundMediaId" | "portraitMediaId"; kind: "image" | "video" | "pdf" | "any" } | null>(null);
  const mediaOp = (uid: string, field: "mediaId" | "backgroundMediaId" | "portraitMediaId", what: "replace" | "clear") => {
    const block = findBlock(draftRef.current.blocks, uid);
    const decl = block && own(byType, block.type)?.mediaFields?.find((f) => f.field === field);
    if (!decl) return;
    if (what === "clear") {
      setProp(uid, field, undefined);
      toast(field === "backgroundMediaId" ? "Fond du thème rétabli" : "Média retiré", "success", { label: "Annuler", run: () => void undoRef.current() });
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
      const op: BoardOp = g.slot ? { op: "fill", key: g.slot, mediaId } : { op: "add", mediaId, index: g.index ?? 0, ...(g.collection ? { collection: g.collection } : {}) };
      const result = await boardDo(g.board, op);
      if (!result) {
        patchGhost(id, { phase: "failed", progress: null, message: "placement refusé" });
        return false;
      }
      const placed = g.slot ?? result.after.slots[g.index ?? 0]?.key;
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
      let collection: "characters" | "backgrounds" | "animation" | undefined;
      if (target.kind === "media" || target.kind === "cell") {
        await uploadToBlock(target, files);
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
        toast("Dépose l'image sur une planche : entre deux images, ou sur une place vide.", "error");
        return;
      }
      if (target.kind === "media" || target.kind === "cell") placeMedia(target, mediaId, kind);
      else if (target.kind === "new") {
        const created = await createProject(target.uid, "Projet sans titre");
        if (created) await boardDo(created.id, { op: "add", mediaId, index: 0 });
      } else if (target.kind === "slot") await boardDo(target.board, { op: "fill", key: target.key, mediaId });
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
      const result = await boardDo(board, { op, key });
      if (result) toast(op === "remove" ? "Image retirée · la place reste" : "Place retirée", "success", { label: "Annuler", run: () => undoRef.current() });
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
      if (over && r) send({ kind: "drag", x: ev.clientX - r.left, y: ev.clientY - r.top, label: m.name.slice(0, 120), payload: "media" });
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
      else if (done) toast(done, "success", { label: "Annuler", run: () => void undoRef.current() });
    });
  };

  const handlers = useRef({ op, editText, fieldOp, tileOp, insert, undo, redo, selectBlock, createProject, setBoardProject, slotOp, boardDo, uploadFiles, processGhost, setGhostList, setProp, mediaOp, siteChange, moveTree, formField, applyLook, applySiteStyle, applySurface, requestInsert, queueLook });
  useEffect(() => {
    handlers.current = { op, editText, fieldOp, tileOp, insert, undo, redo, selectBlock, createProject, setBoardProject, slotOp, boardDo, uploadFiles, processGhost, setGhostList, setProp, mediaOp, siteChange, moveTree, formField, applyLook, applySiteStyle, applySurface, requestInsert, queueLook };
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
          setCanvasBlocks(msg.blocks);
          // Une autre page (lien suivi en aperçu) : jamais éditable ici.
          send({ kind: "mode", mode: own ? mode : "preview" });
          if (own && selected) send({ kind: "select", uid: selected });
          send({
            kind: "projects",
            list: projectsList.map(({ slug, title, draft, ...rest }) => ({ slug, title: title.slice(0, 200), ...(draft ? { draft: true } : {}), ...("onPage" in rest ? { onPage: Boolean(rest.onPage) } : {}) })),
          });
          send({ kind: "ghosts", items: ghostsRef.current.map(toWire) });
          send({ kind: "site-lock", page: siteLocked });
          send({ kind: "pages", list: navPagesRef.current });
          break;
        }
        case "blocks":
          setCanvasBlocks(msg.blocks);
          break;
        case "board-create":
          void h.createProject(msg.uid, msg.name);
          break;
        case "board-pick":
          h.setBoardProject(msg.uid, msg.slug);
          break;
        case "slot-op":
          void h.slotOp(msg.board, msg.key, msg.op);
          break;
        case "slot-move":
          void h.boardDo(msg.board, { op: "move", key: msg.key, index: msg.index });
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
          h.selectBlock(msg.uid, { notify: false });
          // Depuis Ajouter ou Médias, un clic choisit l'endroit visé : l'onglet reste.
          if (msg.uid && !mobile) setTab((t) => (t === "structure" ? "reglages" : t));
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
          h.setProp(msg.uid, "layout", msg.layout);
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
        case "look":
          void h.applyLook(msg.uid, msg.look);
          break;
        case "site-style":
          h.applySiteStyle(msg.role, msg.style);
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
        case "site-look":
          lookEchoed.current++;
          h.queueLook(msg.palette, msg.logo, msg.seq);
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
  }, [send, mode, locale, paths, selected, mobile, projectsList]);

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
    if (e.button !== 0 || e.pointerType === "touch") return;
    const card = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const frameRect = () => frameRef.current?.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        dragging = true;
        card.setPointerCapture(ev.pointerId);
        dropIndexRef.current = null;
        // Pas de sélection de texte du navigateur pendant le glisser.
        noSelection(true);
      }
      const r = frameRect();
      const over = Boolean(r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom);
      setPaletteDrag({ type: entry.type, label: entry.label, x: ev.clientX, y: ev.clientY, over });
      if (over && r) send({ kind: "drag", x: ev.clientX - r.left, y: ev.clientY - r.top, label: entry.label, blockType: entry.type, nesting: nestingOfEntry(entry) });
      else if (dropIndexRef.current !== null || dropRefused) {
        dropIndexRef.current = null;
        setDropIndex(null);
        setDropRefused(false);
        send({ kind: "drag-end" });
      }
    };
    const end = (commit: boolean) => {
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", esc, true);
      if (!dragging) return;
      // Le clic qui suit un glisser ne doit pas insérer une seconde fois.
      card.dataset.dragged = "1";
      setTimeout(() => delete card.dataset.dragged, 0);
      const place = dropIndexRef.current;
      setPaletteDrag(null);
      setDropIndex(null);
      setDropRefused(false);
      dropIndexRef.current = null;
      noSelection(false);
      send({ kind: "drag-end" });
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

  const publish = async () => {
    setPublishing(true);
    try {
      await commitLookRef.current();
      clearTimeout(timer.current);
      const result = await withLock(async () => {
        if (dirty.current && !(await runSave())) return null;
        return publishDraftAction(pageId, revRef.current);
      });
      if (!result) {
        toast("Le brouillon n'est pas enregistré : réessaie.", "error");
        return;
      }
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
        toast("Publication impossible : corrige ce qui est signalé.", "error");
        return;
      }
      revRef.current = result.data.rev;
      // Publié : les instantanés de planche d'avant ne sont plus des brouillons.
      history.current = { past: [], future: [] };
      boards.current.clear();
      bumpHistory();
      setPublishErrors({});
      setPublishMessage(null);
      setHasDraft(false);
      toast(result.data.site ? "Publié : la page est en ligne, l'en-tête et le pied de page sont à jour sur toutes les pages" : "Publié : la page est en ligne");
      setSitePending(false);
      send(refreshMsg(false));
      router.refresh();
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    setDiscardBusy(true);
    clearTimeout(timer.current);
    dirty.current = false;
    const result = await withLock(() => discardDraftAction(pageId, revRef.current));
    if (!result.ok) {
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
  const pageErrors = Object.entries(publishErrors).filter(([k]) => !k.startsWith("blocks."));
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
            : hasDraft
              ? { tone: "draft", text: "Brouillon enregistré" }
              : draft.published
                ? { tone: "ok", text: "Publié" }
                : { tone: "idle", text: "Page non publiée" };

  const frameWidth = mobile ? null : DEVICES.find((d) => d.id === device)?.width ?? null;
  const frameSrc = `/admin/api/editeur/toile?page=${pageId}&langue=${locale}`;
  const media = context.media;
  const [mediaTags, setMediaTags] = useState<string[]>([]);
  const tagOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of media) for (const t of m.tags) seen.set(t.label.toLowerCase(), t.label);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr"));
  }, [media]);
  const shownMedia = useMemo(() => filterMedia(media, mediaTags, ""), [media, mediaTags]);

  const panel = (
    <aside className="ve-panel" data-open={sheet || undefined} aria-label="Outils de l'éditeur" inert={mobile && !sheet ? true : undefined}>
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
            <p className="ve-hint">{mobile ? "Touche un composant pour l'ajouter sous le bloc choisi." : "Glisse-le sur la page, à l'endroit voulu. Ou clique pour l'ajouter sous le bloc sélectionné."}</p>
            <input
              type="search"
              className="a-input ve-search"
              placeholder="Chercher un composant"
              aria-label="Chercher un composant"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
            />
            {addGroups.length === 0 && <p className="ve-empty">Aucun composant ne correspond à « {addQuery.trim()} ».</p>}
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
                    {g.entries.map((c) => (
                      <li key={c.key}>
                        <button
                          type="button"
                          className="ve-card"
                          data-type={c.type}
                          data-key={c.key}
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
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </>
        )}

        {tab === "medias" && (
          <>
            <Uploader origin={`editeur-${pageId}`} libraryLabel="Voir dans la Médiathèque" />
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
              <p className="ve-empty">{media.length ? "Aucun média ne porte tous ces tags." : "Ta médiathèque est vide : dépose des fichiers ci-dessus."}</p>
            ) : (
              <ul className="ve-media" aria-label="Médias">
                {shownMedia.slice(0, 120).map((m) => (
                  <li
                    key={m.id}
                    title={`${m.name} : glisse sur une planche`}
                    style={{ backgroundColor: m.color ?? undefined }}
                    data-media={m.id}
                    data-status={m.status}
                    onPointerDown={(e) => onMediaDown(e, m)}
                  >
                    {m.thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumb} alt={m.alt.fr || m.name} loading="lazy" draggable={false} />
                    )}
                    {m.kind === "video" && <span className="ve-media-kind" aria-hidden="true">▶</span>}
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
                  </li>
                ))}
              </ul>
            )}
            <p className="ve-hint">
              Glisse une image sur une planche de la page : entre deux images, ou sur une place vide. Tu peux aussi déposer des fichiers de ton
              ordinateur directement sur la planche.
            </p>
          </>
        )}

        {tab === "structure" &&
          (blocks.length === 0 ? (
            <p className="ve-empty">La page est vide. Ajoute un premier composant depuis « Ajouter ».</p>
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
          (selected === "site-header" || selected === "site-footer" ? (
            <>
            <SiteEditor
              which={selected === "site-header" ? "header" : "footer"}
              snap={siteSnap}
              pages={pages}
              locked={siteLocked}
              onChange={(change) =>
                void writeSite((cur) => {
                  const next = JSON.parse(JSON.stringify(cur)) as SiteSnap;
                  change(next);
                  return SiteSnapSchema.safeParse(next).success ? next : null;
                })
              }
            />
            {selected === "site-header" && <LogoPanel value={liveLook.logo} onChange={(l) => requestLook(liveLook.palette, l)} locked={siteLocked} />}
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
                    <button type="button" className="a-icon-btn" aria-label="Sortir du conteneur" title="Sortir du conteneur" onClick={() => op("out", selBlock.uid)}>
                      ⇱
                    </button>
                  )}
                  <button type="button" className="a-icon-btn" aria-label="Dupliquer" onClick={() => op("duplicate", selBlock.uid)}>
                    ⧉
                  </button>
                  <button type="button" className="a-icon-btn a-danger-text" aria-label="Supprimer" onClick={() => op("delete", selBlock.uid)}>
                    ✕
                  </button>
                </div>
              </header>
              <p className="ve-hint">{selDef.description}</p>
              {selDef.inline.length > 0 && <p className="ve-hint">Les textes se modifient aussi directement sur la page : double-clic dessus.</p>}
              {selPath && publishErrors[selPath] && <p className="a-field-error">{publishErrors[selPath]}</p>}
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
                <p className="ve-empty">Ce type de bloc n&apos;a pas de réglages.</p>
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
                Titre, adresses et référencement de la page : <Link href={`/admin/pages/${pageId}`}>formulaire de la page</Link>.
              </p>
              <div className="ve-page-collection">
                <PageCollectionField
                  value={draft.collection}
                  onChange={(v) => apply({ ...draftRef.current, collection: v }, { structural: true })}
                  pages={context.pages}
                  pageId={pageId}
                  error={publishErrors.collection}
                />
              </div>
              <ColorsPanel theme={lookContext.theme} value={liveLook.palette} onChange={(p) => requestLook(p, liveLook.logo)} onHighlight={highlightRole} info={hlInfo} locked={siteLocked} />
              <LogoPanel value={liveLook.logo} onChange={(l) => requestLook(liveLook.palette, l)} locked={siteLocked} />
              <SiteStylesPanel styles={siteSnap.styles} onChange={(s) => void applySiteStyles(() => s, Object.values(cleanSiteStyles(s)?.roles ?? {}))} palette={swatches} cardPalette={effective} installed={fontFamilies} locked={siteLocked} />
            </div>
          ))}
      </div>
    </aside>
  );

  return (
    <div className="ve" data-mode={mode} data-mobile={mobile || undefined}>
      {mode === "edit" && (
        <header className="ve-top">
          <Link href="/admin/pages" className="ve-brand" title="Retour aux pages">
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
          <div className="a-seg ve-seg" role="group" aria-label="Langue">
            {(["fr", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                lang={l}
                onClick={() => {
                  if (l === locale) return;
                  setFrameReady(false);
                  setLocale(l);
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="ve-break" aria-hidden="true" />
          {!mobile && (
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
            <button type="button" className="a-icon-btn" onClick={undo} disabled={!historyLen.past} aria-label="Annuler" title="Annuler (Ctrl+Z)">
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
          {hasDraft && !mobile && !blocked && saveState !== "error" && (
            <button type="button" className="a-btn a-btn-quiet ve-discard" onClick={() => setDiscarding(true)}>
              Abandonner les modifications
            </button>
          )}
          <button type="button" className="a-btn" onClick={() => setMode("preview")} disabled={foreign}>
            Aperçu
          </button>
          <button
            type="button"
            className="a-btn a-btn-primary"
            onClick={() => void publish()}
            disabled={publishing || Boolean(blocked) || (!hasDraft && !sitePending && saveState === "idle")}
            title={!hasDraft && saveState === "idle" ? "Aucune modification à publier" : undefined}
          >
            {publishing ? "Publication…" : "Publier"}
          </button>
        </header>
      )}

      <div className="ve-body">
        {mode === "edit" && panel}
        <main className="ve-canvas" data-device={mobile ? "phone" : device}>
          {(publishMessage || pageErrors.length > 0) && mode === "edit" && (
            <div className="ve-alert" role="alert">
              <strong>{publishMessage}</strong>
              {pageErrors.map(([k, v]) => (
                <span key={k}>
                  {v} <Link href={`/admin/pages/${pageId}`}>Ouvrir le formulaire</Link>
                </span>
              ))}
            </div>
          )}
          {blocked === "conflict" && mode === "edit" && (
            <div className="ve-alert ve-alert-strong" role="alert" data-testid="conflict">
              <p>
                <strong>Cette page a été modifiée ailleurs</strong> (autre onglet, formulaire ou publication). Tes dernières modifications
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
                <strong>Ce brouillon ne peut plus être lu</strong> (un composant a changé). La toile montre ce qui en reste ; rien ne
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
              <strong>En-tête modifié</strong> (nom, menu, pied de page ou réseaux) : à la publication de cette page, il change sur <strong>toutes les pages</strong>.
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
          <div className="ve-frame-wrap" style={{ maxWidth: mode === "preview" && device === "desktop" ? undefined : (frameWidth ?? undefined) }}>
            {!frameReady && <div className="ve-loading">Chargement de la page…</div>}
            <iframe
              key={locale}
              ref={frameRef}
              className="ve-frame"
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
          if (p) void boardDo(p.board, { op: "fill", key: p.key, mediaId });
        }}
        onFile={(file) => {
          const p = picker;
          setPicker(null);
          if (p) void uploadFiles({ kind: "slot", board: p.board, key: p.key }, [file]);
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
        title={`Supprimer ${deletingBlock && isContainer(deletingBlock.type) ? "le conteneur" : "le bloc"} « ${deletingBlock ? (own(byType, deletingBlock.type)?.label ?? "") : ""} » ?`}
        confirmLabel={deletingCount ? `Supprimer avec ses ${deletingCount} composant${deletingCount > 1 ? "s" : ""}` : "Supprimer le bloc"}
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      >
        {deletingCount > 0 && (
          <p data-testid="delete-count">
            <strong>
              {deletingCount} composant{deletingCount > 1 ? "s" : ""} {deletingCount > 1 ? "seront retirés" : "sera retiré"} avec lui.
            </strong>
          </p>
        )}
        {deletingLost.length > 0 && <p>Les changements d&apos;images {deletingLost.length > 1 ? "de ses planches" : "de sa planche"} ne seront pas publiés (les images en ligne ne bougent pas).</p>}
        <p className="muted">Il disparaît du brouillon ; « Annuler » (Ctrl+Z) le récupère. Le site ne change qu&apos;à la publication.</p>
      </ConfirmDialog>

      <AddSectionDialog
        open={adding !== null}
        catalog={catalog}
        where={
          adding === null
            ? ""
            : adding.parent
              ? `Dans « ${own(byType, findBlock(blocks, adding.parent)?.type ?? "")?.label ?? "le conteneur"} »`
              : adding.index >= blocks.length
                ? "À la fin de la page"
                : adding.index === 0
                  ? "En tête de page"
                  : "Entre deux rubriques"
        }
        onClose={() => setAdding(null)}
        onPick={(choice: AddChoice) => {
          const at = adding;
          setAdding(null);
          if (!at) return;
          if (choice.kind === "starter") insertStarter(choice.starter, at);
          else insert(choice.key, at);
        }}
      />

      <MediaPickerDialog
        open={mediaPick !== null}
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
