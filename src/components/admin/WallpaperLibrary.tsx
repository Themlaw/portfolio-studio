"use client";

/**
 * Bibliothèque des papiers peints (lot 35, Admin → Thèmes → Papiers peints) : on importe autant de motifs qu'on veut (PNG / WebP sur
 * fond transparent, par la file d'envoi commune), on voit chacun sur un fond clair ET un fond sombre, on le renomme, on règle la taille de
 * sa tuile et son opacité par défaut, on le supprime. Supprimer un motif utilisé : une boîte qui liste les endroits, puis la corbeille
 * (30 jours, « Annuler » 10 s) ; il quitte le rendu sans rien casser. Un panneau choisit aussi le papier peint par défaut des cartes.
 */
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  createWallpaperAction,
  listWallpapersAction,
  renameWallpaperAction,
  restoreWallpaperAction,
  saveCardWallpaperAction,
  saveWallpaperPaintAction,
  trashWallpaperAction,
  wallpaperUsesAction,
} from "@/app/admin/(espace)/papiers-peints/actions";
import type { WallpaperUseRow } from "@/lib/admin";
import { daysLeft } from "@/lib/trash";
import type { AdminWallpaper } from "@/lib/wallpapers";
import { PAPER_READABLE_MAX, PAPER_READABLE_WARNING, WALLPAPER_OPACITY_MIN, WALLPAPER_SIZE_MAX, WALLPAPER_SIZE_MIN } from "@/themes/schema";
import type { CardWallpaper } from "@/themes/wallpaper";

import { ConfirmDialog, toast, undoToast } from "./editing";
import { PurgeItem } from "./TrashControls";
import { useUploadQueue } from "./UploadQueue";

const ORIGIN = "papiers-peints";
const ACCEPTED = /\.(png|webp|avif)$/i;
/** Plafond d'opacité d'un papier sur une carte (comme le papier du kit : au-delà le texte se lit mal). */

/** Une phrase par endroit : « Page « Accueil » · composant « Texte » ». */
function labelOf(u: WallpaperUseRow, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (u.kind === "cards") return t("useCards");
  return t(u.kind === "page" ? "usePage" : "useBlock", { title: u.pageTitle, trashed: u.trashed ? "yes" : "no", block: u.kind === "page" ? "" : u.blockType });
}

/** Aperçu d'un motif : deux moitiés, fond clair et fond sombre (les motifs sont dessinés sur transparent). */
function Preview({ src, size, opacity, compact }: { src: string | null; size: number; opacity: number; compact?: boolean }) {
  const tile = Math.max(14, Math.min(compact ? 40 : 110, Math.round(size * (compact ? 0.12 : 0.3))));
  return (
    <span className="a-wp-preview" data-compact={compact || undefined} aria-hidden="true">
      {(["light", "dark"] as const).map((tone) => (
        <span key={tone} className="a-wp-half" data-tone={tone}>
          {src && <span className="a-wp-layer" style={{ backgroundImage: `url("${src}")`, backgroundSize: `${tile}px auto`, opacity }} />}
        </span>
      ))}
    </span>
  );
}

function Card({ w, uses, onChanged, onDelete }: { w: AdminWallpaper; uses: number; onChanged: () => void; onDelete: (w: AdminWallpaper) => void }) {
  const t = useTranslations("wallpapers");
  const [name, setName] = useState(w.name);
  const [size, setSize] = useState(w.size);
  const [opacity, setOpacity] = useState(w.opacity);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const savePaint = (nextSize: number, nextOpacity: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await saveWallpaperPaintAction(w.id, { size: nextSize, opacity: nextOpacity });
      if (!r.ok) toast(r.message, "error");
      else onChanged();
    }, 350);
  };
  const rename = async () => {
    const next = name.trim();
    if (next === w.name) return;
    const r = await renameWallpaperAction(w.id, next);
    if (!r.ok) {
      toast(r.message, "error");
      setName(w.name);
      return;
    }
    toast(t("renamed", { name: next }));
    onChanged();
  };

  return (
    <li className="a-wp-card" data-testid="wallpaper" data-wallpaper-id={w.id} data-status={w.status}>
      <Preview src={w.thumb} size={size} opacity={opacity} />
      {w.status === "processing" && <p className="a-help">{t("processing")}</p>}
      {w.status === "failed" && <p className="a-help a-danger-text">{t("failed")}</p>}
      <label className="a-field">
        <span className="a-field-label">{t("name")}</span>
        <input className="a-input" value={name} maxLength={60} aria-label={t("patternName", { name: w.name })} data-testid="wallpaper-name" onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </label>
      <label className="a-field">
        {t("size", { size })}
        <input
          type="range"
          min={WALLPAPER_SIZE_MIN}
          max={WALLPAPER_SIZE_MAX}
          step={1}
          value={size}
          data-testid="wallpaper-size"
          onChange={(e) => {
            setSize(Number(e.target.value));
            savePaint(Number(e.target.value), opacity);
          }}
        />
      </label>
      <label className="a-field">
        {t("opacity", { pct: Math.round(opacity * 100) })}
        <input
          type="range"
          min={Math.round(WALLPAPER_OPACITY_MIN * 100)}
          max={100}
          step={1}
          value={Math.round(opacity * 100)}
          data-testid="wallpaper-opacity"
          onChange={(e) => {
            setOpacity(Number(e.target.value) / 100);
            savePaint(size, Number(e.target.value) / 100);
          }}
        />
      </label>
      <p className="a-help">{t("defaultsHelp")}</p>
      {w.opaque && (
        <p className="a-notice" role="status" data-testid="wallpaper-opaque">
          {t("opaque")}
        </p>
      )}
      <div className="a-wp-foot">
        <span className="a-wp-uses" data-testid="wallpaper-uses">
          {uses ? t("usedAt", { count: uses }) : t("notUsed")}
        </span>
        <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" data-testid="wallpaper-delete" onClick={() => onDelete(w)}>
          {t("delete")}
        </button>
      </div>
    </li>
  );
}

/** Papier peint par défaut des cartes du site : « le papier du thème » (comme avant) ou un motif de la bibliothèque. */
function CardDefault({ ready, value, onChanged }: { ready: AdminWallpaper[]; value: CardWallpaper | null; onChanged: () => void }) {
  const t = useTranslations("wallpapers");
  const [cur, setCur] = useState<CardWallpaper | null>(value);
  // Nouvelle lecture du serveur : on la reprend, sauf si une modification attend encore d'être enregistrée (curseur en cours).
  const sig = JSON.stringify(value);
  const [seen, setSeen] = useState(sig);
  const [waiting, setWaiting] = useState(false);
  if (sig !== seen) {
    setSeen(sig);
    if (!waiting) setCur(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const entry = cur ? ready.find((w) => w.id === cur.wallpaper) : undefined;
  const save = (next: CardWallpaper | null, delay = 0) => {
    setCur(next);
    setWaiting(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await saveCardWallpaperAction(next);
      setWaiting(false);
      if (!r.ok) {
        toast(r.message, "error");
        setCur(value);
      } else onChanged();
    }, delay);
  };
  const size = cur?.size ?? entry?.size ?? 300;
  const opacity = cur?.opacity ?? entry?.opacity ?? 1;
  return (
    <section className="a-panel" aria-labelledby="wp-cartes" data-testid="wallpaper-cards">
      <h2 id="wp-cartes">{t("cardsTitle")}</h2>
      <p className="a-help">
        {t("cardsHelp")}
      </p>
      <div className="a-seg" role="radiogroup" aria-label={t("cardsTitle")}>
        <button type="button" role="radio" aria-checked={!cur} data-testid="wallpaper-cards-none" className="a-btn a-btn-small" onClick={() => save(null)}>
          {t("asBefore")}
        </button>
        <button type="button" role="radio" aria-checked={Boolean(cur)} data-testid="wallpaper-cards-on" className="a-btn a-btn-small" disabled={!ready.length} onClick={() => !cur && ready[0] && save({ wallpaper: ready[0].id })}>
          {t("aWallpaper")}
        </button>
      </div>
      {cur && (
        <>
          <div className="a-wp-choices" role="radiogroup" aria-label={t("cardsPattern")}>
            {ready.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={cur.wallpaper === w.id} className="a-wp-choice" data-wallpaper-id={w.id} title={w.name} onClick={() => save({ wallpaper: w.id })}>
                <Preview src={w.thumb} size={w.size} opacity={w.opacity} compact />
                <span className="a-wp-name">{w.name}</span>
              </button>
            ))}
            {!entry && <p className="a-help">{t("patternGone")}</p>}
          </div>
          <label className="a-field">
            {t("size", { size })}
            <input type="range" min={WALLPAPER_SIZE_MIN} max={WALLPAPER_SIZE_MAX} step={1} value={size} data-testid="wallpaper-cards-size" onChange={(e) => save({ ...cur, size: Number(e.target.value) }, 350)} />
          </label>
          <label className="a-field">
            {t("opacity", { pct: Math.round(opacity * 100) })}
            <input
              type="range"
              min={Math.round(WALLPAPER_OPACITY_MIN * 100)}
              max={100}
              step={1}
              value={Math.round(opacity * 100)}
              data-testid="wallpaper-cards-opacity"
              onChange={(e) => save({ ...cur, opacity: Number(e.target.value) / 100 }, 350)}
            />
            {opacity > PAPER_READABLE_MAX && (
              <span className="a-help" role="status" data-testid="wallpaper-cards-warning">
                {PAPER_READABLE_WARNING}
              </span>
            )}
          </label>
        </>
      )}
    </section>
  );
}

export default function WallpaperLibrary({ initial, trashed, counts, cards }: { initial: AdminWallpaper[]; trashed: AdminWallpaper[]; counts: Record<number, number>; cards: CardWallpaper | null }) {
  const router = useRouter();
  const t = useTranslations("wallpapers");
  const { addFiles, onMediaCreated, items, batches, dismiss } = useUploadQueue();
  const [list, setList] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [over, setOver] = useState(false);
  const [busy, start] = useTransition();
  const [target, setTarget] = useState<{ w: AdminWallpaper; uses: WallpaperUseRow[] } | null>(null);
  const mine = useRef(new Set<string>());
  const refresh = () => router.refresh();

  // Nouvelle lecture du serveur (router.refresh) : la liste locale la reprend.
  if (seen !== initial) {
    setSeen(initial);
    setList(initial);
  }

  // Un fichier envoyé depuis cet écran devient un papier peint dès que son média existe.
  useEffect(
    () =>
      onMediaCreated((item, media) => {
        if (!mine.current.has(item.batchId)) return;
        void createWallpaperAction(media.id).then((r) => {
          if (!r.ok) toast(r.message, "error");
          else toast(r.data.reused ? t("alreadyInLibrary", { name: r.data.name }) : t("added", { name: r.data.name }));
          dismiss(item.key);
          router.refresh();
        });
      }),
    [onMediaCreated, dismiss, router, t],
  );

  // Fichier encore en traitement : on relit la bibliothèque tant qu'il n'est pas prêt.
  const pending = list.some((w) => w.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void listWallpapersAction().then((r) => r.ok && setList(r.data)), 2000);
    return () => clearInterval(t);
  }, [pending]);

  const send = (files: File[]) => {
    const ok = files.filter((f) => ACCEPTED.test(f.name) || /^image\/(png|webp|avif)$/.test(f.type));
    for (const f of files) if (!ok.includes(f)) toast(t("badFormat", { name: f.name }), "error");
    if (!ok.length) return;
    mine.current.add(addFiles(ok, { origin: ORIGIN }));
  };

  const askDelete = async (w: AdminWallpaper) => {
    const r = await wallpaperUsesAction(w.id);
    setTarget({ w, uses: r.ok ? r.data : [] });
  };
  const confirmDelete = () =>
    start(async () => {
      if (!target) return;
      const { w } = target;
      const r = await trashWallpaperAction(w.id);
      setTarget(null);
      if (!r.ok) return toast(r.message, "error");
      undoToast(w.name, () => void restoreWallpaperAction(w.id).then((x) => (x.ok ? (toast(t("restored", { name: w.name })), router.refresh()) : toast(x.message, "error"))));
      router.refresh();
    });

  const mineBatches = new Set(batches.filter((b) => b.origin === ORIGIN).map((b) => b.id));
  const mineItems = items.filter((i) => mineBatches.has(i.batchId));
  const ready = list.filter((w) => w.status === "ready");

  return (
    <div className="a-wp" data-testid="wallpaper-library">
      <section className="a-panel" aria-labelledby="wp-import">
        <h2 id="wp-import">{t("importTitle")}</h2>
        <label
          className="a-wp-drop"
          data-over={over || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            send([...e.dataTransfer.files]);
          }}
        >
          <input
            type="file"
            multiple
            accept="image/png,image/webp,image/avif,.png,.webp,.avif"
            className="sr-only"
            data-testid="wallpaper-input"
            onChange={(e) => {
              send([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <span>{t("dropHere")}</span>
          <small>{t("dropHelp")}</small>
        </label>
        {mineItems.length > 0 && (
          <ul className="a-wp-queue" aria-label={t("uploading")}>
            {mineItems.map((i) => (
              <li key={i.key} data-phase={i.phase}>
                <span>{i.name}</span>
                <span>{i.phase === "failed" ? (i.message ?? t("phaseFailed")) : i.phase === "uploading" ? t("phaseUploading", { pct: Math.round(i.progress * 100) }) : i.phase === "waiting" ? t("phaseWaiting") : t("phaseAdding")}</span>
                {i.phase === "failed" && (
                  <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => dismiss(i.key)}>
                    {t("remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wp-liste">
        <h2 id="wp-liste" className="a-wp-h">
          {t("library")} <span className="muted">{list.length}</span>
        </h2>
        {list.length === 0 ? (
          <p className="a-help" data-testid="wallpaper-empty">
            {t("empty")}
          </p>
        ) : (
          <ul className="a-wp-grid">
            {list.map((w) => (
              <Card key={w.id} w={w} uses={counts[w.id] ?? 0} onChanged={refresh} onDelete={(x) => void askDelete(x)} />
            ))}
          </ul>
        )}
      </section>

      <CardDefault ready={ready} value={cards} onChanged={refresh} />

      {trashed.length > 0 && (
        <section className="a-panel" aria-labelledby="wp-corbeille" data-testid="wallpaper-trash">
          <h2 id="wp-corbeille">
            {t("trash")} <span className="muted">{trashed.length}</span>
          </h2>
          <p className="a-help">{t("trashHelp")}</p>
          <ul className="a-wp-trash">
            {trashed.map((w) => (
              <li key={w.id} data-wallpaper-id={w.id}>
                <Preview src={w.thumb} size={w.size} opacity={w.opacity} compact />
                <span className="a-wp-trash-name">
                  {w.name}
                  <small>{w.deletedAt ? t("daysLeft", { count: daysLeft(w.deletedAt) }) : ""}</small>
                </span>
                <button
                  type="button"
                  className="a-btn a-btn-small"
                  data-testid="wallpaper-restore"
                  onClick={() =>
                    void restoreWallpaperAction(w.id).then((r) => {
                      if (!r.ok) return toast(r.message, "error");
                      toast(t("restored", { name: w.name }));
                      router.refresh();
                    })
                  }
                >
                  {t("restore")}
                </button>
                <PurgeItem kind="wallpaper" id={w.id} name={w.name} lost={t("purgeLost")} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={target !== null}
        title={target ? t("deleteTitle", { name: target.w.name }) : ""}
        confirmLabel={t("toTrash")}
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setTarget(null)}
      >
        {target && target.uses.length > 0 ? (
          <div data-testid="wallpaper-delete-uses">
            <p>
              {t("usedIn", { count: target.uses.length })}
            </p>
            <ul>
              {target.uses.map((u, i) => (
                <li key={i}>{labelOf(u, t)}</li>
              ))}
            </ul>
            <p>{t("deleteLoses")}</p>
          </div>
        ) : (
          <p>{t("deleteSimple")}</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
