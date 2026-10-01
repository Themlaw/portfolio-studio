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

import { discardDraftAction, publishDraftAction, saveDraftAction } from "@/app/admin/(espace)/pages/actions";
import { BlockEditorContext } from "@/blocks/editor-context";
import type { BlockCatalogEntry, EditorContext } from "@/blocks/editor-types";
import { renderSummary } from "@/blocks/summary";
import type { DraftBlock, PageDraft } from "@/lib/edit/drafts";
import { acceptFromCanvas, EDIT_MSG, inlineAllowed, moveTo, setLocalizedAt, type BlockInfo, type ToCanvas } from "@/lib/edit/protocol";
import { own } from "@/lib/own";

import { clone, ConfirmDialog, toast, useUnsavedGuard } from "../editing";
import { filterMedia } from "../LibraryStrip";
import { DragHandle, SortableList } from "../Sortable";
import Uploader from "../Uploader";
import BlockThumb from "./thumbs";

type Locale = "fr" | "en";
type Device = "desktop" | "tablet" | "phone";
type Tab = "ajouter" | "medias" | "structure" | "reglages";
type SaveState = "idle" | "pending" | "saving" | "error";

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

/** Les textes du brouillon (FR / EN), bloc par bloc : à copier avant de recharger. */
function draftTexts(draft: PageDraft, byType: Record<string, BlockCatalogEntry>): string {
  const out: string[] = [];
  const walk = (v: unknown, lines: string[]) => {
    if (!v || typeof v !== "object") return;
    const l = v as { fr?: unknown; en?: unknown };
    if (typeof l.fr === "string" && typeof l.en === "string") {
      if (l.fr) lines.push(`FR : ${l.fr}`);
      if (l.en) lines.push(`EN : ${l.en}`);
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

/** Erreurs d'un bloc (publication refusée), relatives à ses props. */
function blockErrors(errors: Record<string, string>, index: number): Record<string, string> {
  const prefix = `blocks.${index}.props.`;
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export default function VisualEditor({
  pageId,
  initial,
  hasDraft: initialHasDraft,
  rev: initialRev,
  corrupt: initialCorrupt,
  paths,
  pages,
  catalog,
  editors,
  context,
  siteName,
  initialLocale,
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
}) {
  const router = useRouter();
  const mobile = useMedia(MOBILE);
  const byType = useMemo(() => Object.fromEntries(catalog.map((c) => [c.type, c])), [catalog]);

  /* ---- Brouillon et historique ------------------------------------------- */

  const [draft, setDraftState] = useState<PageDraft>(() => clone(initial));
  const draftRef = useRef(draft);
  // Historique hors état React (pas d'effets dans un updater) ; `historyRev` redessine.
  const history = useRef<{ past: PageDraft[]; future: PageDraft[] }>({ past: [], future: [] });
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
  const [discarding, setDiscarding] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [foreign, setForeign] = useState(false);
  const [canvasBlocks, setCanvasBlocks] = useState<BlockInfo[]>([]);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  const send = useCallback((msg: ToCanvas) => {
    frameRef.current?.contentWindow?.postMessage({ type: EDIT_MSG, ...msg }, window.location.origin);
  }, []);

  /* ---- Enregistrement automatique ---------------------------------------- */

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);

  const runSave = useCallback(async (): Promise<boolean> => {
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
      try {
        result = await saveDraftAction(pageId, snapshot, revRef.current);
      } catch {
        result = { ok: false, message: "connexion perdue" };
      }
      if (!result.ok) {
        ok = false;
        dirty.current = true;
        if ("code" in result) {
          // Rien n'a été écrasé : l'éditeur s'arrête et propose de recharger.
          blockedRef.current = result.code;
          setBlocked(result.code);
          setSaveState("idle");
        } else {
          setSaveState("error");
          setSaveError(result.message);
        }
        break;
      }
      revRef.current = result.data.rev;
      setHasDraft(true);
    }
    if (ok) {
      setSaveState("idle");
      setSaveError(null);
      send({ kind: "refresh" });
    }
    return ok;
  }, [pageId, send]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    while (inflight.current) await inflight.current;
    if (!dirty.current) return true;
    const run = runSave();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [runSave]);

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
  // Bloqué (modifié ailleurs) : « Recharger » est un choix explicite, pas de garde.
  useUnsavedGuard(!blocked && (saveState === "pending" || saveState === "saving" || saveState === "error"));

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
      history.current = { past: merge ? history.current.past : [...history.current.past, prev].slice(-HISTORY_MAX), future: [] };
      bumpHistory();
      coalesce.current = opts.key ? { key: opts.key, at: now } : null;
      draftRef.current = next;
      setDraftState(next);
      schedule(opts.structural ? 0 : DEBOUNCE_MS);
    },
    [schedule],
  );

  const undo = useCallback(() => {
    if (blockedRef.current) return;
    const h = history.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    history.current = { past: h.past.slice(0, -1), future: [draftRef.current, ...h.future] };
    bumpHistory();
    draftRef.current = prev;
    setDraftState(prev);
    coalesce.current = null;
    schedule(0);
    toast("Annulé");
  }, [schedule]);

  const redo = useCallback(() => {
    if (blockedRef.current) return;
    const h = history.current;
    if (!h.future.length) return;
    const [next, ...rest] = h.future;
    history.current = { past: [...h.past, draftRef.current], future: rest };
    bumpHistory();
    draftRef.current = next;
    setDraftState(next);
    coalesce.current = null;
    schedule(0);
    toast("Rétabli");
  }, [schedule]);

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

  const insert = (type: string, at?: number) => {
    const def = own(byType, type);
    if (!def) return;
    if (draftRef.current.blocks.length >= 40) {
      toast("40 blocs au plus par page.", "error");
      return;
    }
    const list = draftRef.current.blocks;
    const sel = selected ? list.findIndex((b) => b.uid === selected) : -1;
    const index = at ?? (sel >= 0 ? sel + 1 : list.length);
    const block: DraftBlock = { uid: newUid(), type, props: clone(def.defaults) };
    setBlocks([...list.slice(0, index), block, ...list.slice(index)]);
    selectBlock(block.uid, { scroll: true });
    toast(`« ${def.label} » ajouté`);
    if (mobile) setSheet(false);
  };

  const op = (kind: "up" | "down" | "duplicate" | "delete", uid: string) => {
    const list = draftRef.current.blocks;
    const i = list.findIndex((b) => b.uid === uid);
    if (i < 0) return;
    if (kind === "delete") {
      setDeleting(uid);
      return;
    }
    if (kind === "up" && i > 0) setBlocks(moveTo(list, i, i - 1));
    if (kind === "down" && i < list.length - 1) setBlocks(moveTo(list, i, i + 2));
    if (kind === "duplicate") {
      if (list.length >= 40) {
        toast("40 blocs au plus par page.", "error");
        return;
      }
      const copy = { ...clone(list[i]), uid: newUid() };
      setBlocks([...list.slice(0, i + 1), copy, ...list.slice(i + 1)]);
      selectBlock(copy.uid);
    }
  };

  const remove = (uid: string) => {
    const list = draftRef.current.blocks;
    const block = list.find((b) => b.uid === uid);
    setDeleting(null);
    if (!block) return;
    setBlocks(list.filter((b) => b.uid !== uid));
    if (selected === uid) selectBlock(null);
    toast("Bloc supprimé · Annuler (Ctrl+Z) pour le récupérer");
  };

  const editText = (uid: string, path: string, textLocale: string, value: string) => {
    const list = draftRef.current.blocks;
    const block = list.find((b) => b.uid === uid);
    const def = block && own(byType, block.type);
    if (!block || !def || !inlineAllowed(def.inline, path) || (textLocale !== "fr" && textLocale !== "en")) return;
    const props = setLocalizedAt(block.props, path, textLocale, value.slice(0, 2000));
    setBlocks(
      list.map((b) => (b.uid === uid ? { ...b, props } : b)),
      { structural: true },
    );
  };

  /* ---- Messages de la toile ---------------------------------------------- */

  const handlers = useRef({ op, editText, insert, undo, redo, selectBlock });
  useEffect(() => {
    handlers.current = { op, editText, insert, undo, redo, selectBlock };
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Origine, source (l'iframe de la toile) et schéma vérifiés ; sinon ignoré.
      const msg = acceptFromCanvas(event, window.location.origin, frameRef.current?.contentWindow);
      if (!msg) return;
      const h = handlers.current;
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
          break;
        }
        case "blocks":
          setCanvasBlocks(msg.blocks);
          break;
        case "select":
          h.selectBlock(msg.uid, { notify: false });
          // Depuis la palette, un clic choisit l'endroit d'insertion : l'onglet reste.
          if (msg.uid && !mobile) setTab((t) => (t === "ajouter" ? t : "reglages"));
          break;
        case "op":
          h.op(msg.op, msg.uid);
          break;
        case "move": {
          const list = draftRef.current.blocks;
          const from = list.findIndex((b) => b.uid === msg.uid);
          if (from >= 0) setBlocks(moveTo(list, from, msg.index));
          break;
        }
        case "text":
          h.editText(msg.uid, msg.path, msg.locale, msg.value);
          break;
        case "drag-index":
          dropIndexRef.current = msg.index;
          setDropIndex(msg.index);
          break;
        case "key":
          if (msg.key === "undo") h.undo();
          else if (msg.key === "redo") h.redo();
          else if (msg.key === "escape" && mode === "preview") setMode("edit");
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, mode, locale, paths, selected, mobile]);

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

  const onPaletteDown = (e: React.PointerEvent<HTMLButtonElement>, entry: BlockCatalogEntry) => {
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
      }
      const r = frameRect();
      const over = Boolean(r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom);
      setPaletteDrag({ type: entry.type, label: entry.label, x: ev.clientX, y: ev.clientY, over });
      if (over && r) send({ kind: "drag", x: ev.clientX - r.left, y: ev.clientY - r.top, label: entry.label });
      else if (dropIndexRef.current !== null) {
        dropIndexRef.current = null;
        setDropIndex(null);
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
      const index = dropIndexRef.current;
      setPaletteDrag(null);
      setDropIndex(null);
      dropIndexRef.current = null;
      send({ kind: "drag-end" });
      if (commit && index !== null) insert(entry.type, index);
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
      if (!(await flush())) {
        toast("Le brouillon n'est pas enregistré : réessaie.", "error");
        return;
      }
      const result = await publishDraftAction(pageId, revRef.current);
      if (!result.ok && "code" in result) {
        blockedRef.current = result.code;
        setBlocked(result.code);
        return;
      }
      if (!result.ok) {
        const fe = result.fieldErrors ?? {};
        setPublishErrors(fe);
        setPublishMessage(result.message);
        const first = Object.keys(fe)
          .map((k) => /^blocks\.(\d+)/.exec(k)?.[1])
          .find((v) => v !== undefined);
        const uid = first !== undefined ? draftRef.current.blocks[Number(first)]?.uid : undefined;
        if (uid) {
          selectBlock(uid, { scroll: true });
          setTab("reglages");
          if (mobile) setSheet(true);
        }
        toast("Publication impossible : corrige ce qui est signalé.", "error");
        return;
      }
      revRef.current = result.data.rev;
      setPublishErrors({});
      setPublishMessage(null);
      setHasDraft(false);
      toast("Publié : la page est en ligne");
      send({ kind: "refresh" });
      router.refresh();
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    setDiscardBusy(true);
    clearTimeout(timer.current);
    dirty.current = false;
    while (inflight.current) await inflight.current;
    const result = await discardDraftAction(pageId, revRef.current);
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

  const selIndex = selected ? blocks.findIndex((b) => b.uid === selected) : -1;
  const selBlock = selIndex >= 0 ? blocks[selIndex] : null;
  const selDef = selBlock ? own(byType, selBlock.type) : undefined;
  const editor = selBlock ? own(editors, selBlock.type) : undefined;
  const pageErrors = Object.entries(publishErrors).filter(([k]) => !k.startsWith("blocks."));
  const errorBlocks = new Set(
    Object.keys(publishErrors)
      .map((k) => /^blocks\.(\d+)/.exec(k)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number),
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
            <ul className="ve-palette">
              {catalog.map((c) => (
                <li key={c.type}>
                  <button
                    type="button"
                    className="ve-card"
                    data-type={c.type}
                    data-dragging={paletteDrag?.type === c.type || undefined}
                    onPointerDown={(e) => onPaletteDown(e, c)}
                    onClick={(e) => {
                      if (e.currentTarget.dataset.dragged) return;
                      insert(c.type);
                    }}
                  >
                    <BlockThumb type={c.type} />
                    <span>
                      <strong>{c.label}</strong>
                      <span className="ve-card-desc">{c.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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
                  <li key={m.id} title={m.name} style={{ backgroundColor: m.color ?? undefined }}>
                    {m.thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumb} alt={m.alt.fr || m.name} loading="lazy" draggable={false} />
                    )}
                    {m.kind === "video" && <span className="ve-media-kind" aria-hidden="true">▶</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="ve-hint">Pour placer une image, choisis le bloc qui l&apos;affiche puis règle-le dans « Réglages ».</p>
          </>
        )}

        {tab === "structure" &&
          (blocks.length === 0 ? (
            <p className="ve-empty">La page est vide. Ajoute un premier composant depuis « Ajouter ».</p>
          ) : (
            <SortableList
              items={blocks}
              getId={(b) => b.uid}
              getLabel={(b) => own(byType, b.type)?.label ?? b.type}
              onReorder={(next) => setBlocks(next)}
              className="a-sortable ve-structure"
              render={(b, i) => {
                const meta = own(byType, b.type);
                const summary = meta ? renderSummary(meta.summary, b.props) : "";
                return (
                  <div className="ve-row" aria-current={b.uid === selected || undefined} data-invalid={errorBlocks.has(i) || undefined}>
                    <DragHandle />
                    <button type="button" className="ve-row-main" onClick={() => selectBlock(b.uid, { scroll: true })}>
                      <span className="ve-row-n">{i + 1}</span>
                      <span className="ve-row-text">
                        <strong>{meta?.label ?? b.type}</strong>
                        {summary && <span className="ve-row-sum">{summary}</span>}
                      </span>
                      {errorBlocks.has(i) && <span className="a-tag a-tag-danger">À corriger</span>}
                    </button>
                  </div>
                );
              }}
            />
          ))}

        {tab === "reglages" &&
          (selBlock && selDef ? (
            <div className="ve-settings">
              <header className="ve-settings-head">
                <h2>{selDef.label}</h2>
                <div className="ve-settings-tools" role="group" aria-label="Bloc sélectionné">
                  <button type="button" className="a-icon-btn" aria-label="Monter" disabled={selIndex === 0} onClick={() => op("up", selBlock.uid)}>
                    ↑
                  </button>
                  <button type="button" className="a-icon-btn" aria-label="Descendre" disabled={selIndex === blocks.length - 1} onClick={() => op("down", selBlock.uid)}>
                    ↓
                  </button>
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
              {publishErrors[`blocks.${selIndex}`] && <p className="a-field-error">{publishErrors[`blocks.${selIndex}`]}</p>}
              {editor ? (
                <BlockEditorContext.Provider
                  value={{
                    value: selBlock.props,
                    onChange: (props) => {
                      const uid = selBlock.uid;
                      setBlocks(
                        draftRef.current.blocks.map((x) => (x.uid === uid ? { ...x, props } : x)),
                        { key: `props:${uid}` },
                      );
                    },
                    errors: blockErrors(publishErrors, selIndex),
                    context,
                    idPrefix: `ve-${selBlock.uid}`,
                  }}
                >
                  {editor}
                </BlockEditorContext.Provider>
              ) : (
                <p className="ve-empty">Ce type de bloc n&apos;a pas de réglages.</p>
              )}
            </div>
          ) : (
            <div className="ve-settings-empty">
              <p>Clique sur un bloc de la page pour le régler. Les textes se modifient directement sur la page.</p>
              <p className="ve-hint">
                Titre, adresses et référencement de la page : <Link href={`/admin/pages/${pageId}`}>formulaire de la page</Link>.
              </p>
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
            disabled={publishing || Boolean(blocked) || (!hasDraft && saveState === "idle")}
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
        title={`Supprimer le bloc « ${deleting ? (own(byType, blocks.find((b) => b.uid === deleting)?.type ?? "")?.label ?? "") : ""} » ?`}
        confirmLabel="Supprimer le bloc"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      >
        <p className="muted">Il disparaît du brouillon ; « Annuler » (Ctrl+Z) le récupère. Le site ne change qu&apos;à la publication.</p>
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
