"use client";

/**
 * Bibliothèque des papiers peints (lot 35, Admin → Thèmes → Papiers peints) : on importe autant de motifs qu'on veut (PNG / WebP sur
 * fond transparent, par la file d'envoi commune), on voit chacun sur un fond clair ET un fond sombre, on le renomme, on règle la taille de
 * sa tuile et son opacité par défaut, on le supprime. Supprimer un motif utilisé : une boîte qui liste les endroits, puis la corbeille
 * (30 jours, « Annuler » 10 s) ; il quitte le rendu sans rien casser. Un panneau choisit aussi le papier peint par défaut des cartes.
 */
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
import { WALLPAPER_OPACITY_MIN, WALLPAPER_SIZE_MAX, WALLPAPER_SIZE_MIN } from "@/themes/schema";
import type { CardWallpaper } from "@/themes/wallpaper";

import { ConfirmDialog, toast, undoToast } from "./editing";
import { PurgeItem } from "./TrashControls";
import { useUploadQueue } from "./UploadQueue";

const ORIGIN = "papiers-peints";
const ACCEPTED = /\.(png|webp|avif)$/i;
/** Plafond d'opacité d'un papier sur une carte (comme le papier du kit : au-delà le texte se lit mal). */
const CARD_MAX_OPACITY = 0.6;

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Une phrase par endroit : « Page « Accueil » · composant « Texte » ». */
function labelOf(u: WallpaperUseRow): string {
  if (u.kind === "cards") return "Cartes du site · papier par défaut";
  const where = `Page « ${u.pageTitle} »${u.trashed ? " (à la corbeille)" : ""}`;
  return u.kind === "page" ? `${where} · papier peint de la page` : `${where} · ${u.blockType}`;
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
    toast(`Renommé · « ${next} »`);
    onChanged();
  };

  return (
    <li className="a-wp-card" data-testid="wallpaper" data-wallpaper-id={w.id} data-status={w.status}>
      <Preview src={w.thumb} size={size} opacity={opacity} />
      {w.status === "processing" && <p className="a-help">Traitement du fichier…</p>}
      {w.status === "failed" && <p className="a-help a-danger-text">Le fichier n&apos;a pas pu être traité : supprime ce motif et renvoie le fichier.</p>}
      <label className="a-field">
        <span className="a-field-label">Nom</span>
        <input className="a-input" value={name} maxLength={60} aria-label={`Nom du motif ${w.name}`} data-testid="wallpaper-name" onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </label>
      <label className="a-field">
        Taille du motif : {size} px
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
        Opacité : {Math.round(opacity * 100)} %
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
      <p className="a-help">Réglages par défaut du motif : chaque endroit où tu le poses peut les remplacer.</p>
      {w.opaque && (
        <p className="a-notice" role="status" data-testid="wallpaper-opaque">
          Ce fichier n&apos;a pas de transparence : il cachera ce qu&apos;il y a derrière lui. Pour un vrai papier peint, exporte-le en PNG ou WebP sur fond transparent.
        </p>
      )}
      <div className="a-wp-foot">
        <span className="a-wp-uses" data-testid="wallpaper-uses">
          {uses ? `Utilisé à ${uses} endroit${uses > 1 ? "s" : ""}` : "Pas encore utilisé"}
        </span>
        <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" data-testid="wallpaper-delete" onClick={() => onDelete(w)}>
          Supprimer
        </button>
      </div>
    </li>
  );
}

/** Papier peint par défaut des cartes du site : « le papier du thème » (comme avant) ou un motif de la bibliothèque. */
function CardDefault({ ready, value, onChanged }: { ready: AdminWallpaper[]; value: CardWallpaper | null; onChanged: () => void }) {
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
  const opacity = Math.min(CARD_MAX_OPACITY, cur?.opacity ?? entry?.opacity ?? 1);
  return (
    <section className="a-panel" aria-labelledby="wp-cartes" data-testid="wallpaper-cards">
      <h2 id="wp-cartes">Papier peint des cartes</h2>
      <p className="a-help">
        Les cartes des blocs cachent le papier du site. Ici, tu peux y poser un de tes motifs, pour toutes les cartes du site. Une carte peut garder son propre choix (menu « Carte » sur la page).
      </p>
      <div className="a-seg" role="radiogroup" aria-label="Papier peint des cartes">
        <button type="button" role="radio" aria-checked={!cur} data-testid="wallpaper-cards-none" className="a-btn a-btn-small" onClick={() => save(null)}>
          Comme avant
        </button>
        <button type="button" role="radio" aria-checked={Boolean(cur)} data-testid="wallpaper-cards-on" className="a-btn a-btn-small" disabled={!ready.length} onClick={() => !cur && ready[0] && save({ wallpaper: ready[0].id })}>
          Un papier peint
        </button>
      </div>
      {cur && (
        <>
          <div className="a-wp-choices" role="radiogroup" aria-label="Motif des cartes">
            {ready.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={cur.wallpaper === w.id} className="a-wp-choice" data-wallpaper-id={w.id} title={w.name} onClick={() => save({ wallpaper: w.id })}>
                <Preview src={w.thumb} size={w.size} opacity={w.opacity} compact />
                <span className="a-wp-name">{w.name}</span>
              </button>
            ))}
            {!entry && <p className="a-help">Ce motif n&apos;est plus dans la bibliothèque : les cartes n&apos;en montrent plus. Choisis-en un autre.</p>}
          </div>
          <label className="a-field">
            Taille du motif : {size} px
            <input type="range" min={WALLPAPER_SIZE_MIN} max={WALLPAPER_SIZE_MAX} step={1} value={size} data-testid="wallpaper-cards-size" onChange={(e) => save({ ...cur, size: Number(e.target.value) }, 350)} />
          </label>
          <label className="a-field">
            Opacité : {Math.round(opacity * 100)} %
            <input
              type="range"
              min={Math.round(WALLPAPER_OPACITY_MIN * 100)}
              max={Math.round(CARD_MAX_OPACITY * 100)}
              step={1}
              value={Math.round(opacity * 100)}
              data-testid="wallpaper-cards-opacity"
              onChange={(e) => save({ ...cur, opacity: Number(e.target.value) / 100 }, 350)}
            />
          </label>
        </>
      )}
    </section>
  );
}

export default function WallpaperLibrary({ initial, trashed, counts, cards }: { initial: AdminWallpaper[]; trashed: AdminWallpaper[]; counts: Record<number, number>; cards: CardWallpaper | null }) {
  const router = useRouter();
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
          else toast(r.data.reused ? `Déjà dans la bibliothèque · « ${r.data.name} »` : `Papier peint ajouté · « ${r.data.name} »`);
          dismiss(item.key);
          router.refresh();
        });
      }),
    [onMediaCreated, dismiss, router],
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
    for (const f of files) if (!ok.includes(f)) toast(`« ${f.name} » : un papier peint doit être un PNG ou un WebP (le JPEG n'a pas de transparence).`, "error");
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
      undoToast(w.name, () => void restoreWallpaperAction(w.id).then((x) => (x.ok ? (toast(`Restauré · « ${w.name} »`), router.refresh()) : toast(x.message, "error"))));
      router.refresh();
    });

  const mineBatches = new Set(batches.filter((b) => b.origin === ORIGIN).map((b) => b.id));
  const mineItems = items.filter((i) => mineBatches.has(i.batchId));
  const ready = list.filter((w) => w.status === "ready");

  return (
    <div className="a-wp" data-testid="wallpaper-library">
      <section className="a-panel" aria-labelledby="wp-import">
        <h2 id="wp-import">Importer des motifs</h2>
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
          <span>Dépose tes motifs ici, ou choisis-les</span>
          <small>PNG ou WebP sur fond transparent, autant que tu veux.</small>
        </label>
        {mineItems.length > 0 && (
          <ul className="a-wp-queue" aria-label="Envois en cours">
            {mineItems.map((i) => (
              <li key={i.key} data-phase={i.phase}>
                <span>{i.name}</span>
                <span>{i.phase === "failed" ? (i.message ?? "Échec") : i.phase === "uploading" ? `Envoi ${Math.round(i.progress * 100)} %` : i.phase === "waiting" ? "En attente" : "Ajout…"}</span>
                {i.phase === "failed" && (
                  <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => dismiss(i.key)}>
                    Retirer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wp-liste">
        <h2 id="wp-liste" className="a-wp-h">
          Ma bibliothèque <span className="muted">{list.length}</span>
        </h2>
        {list.length === 0 ? (
          <p className="a-help" data-testid="wallpaper-empty">
            Aucun papier peint pour l&apos;instant. Importe ton premier motif ci-dessus.
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
            Corbeille <span className="muted">{trashed.length}</span>
          </h2>
          <p className="a-help">Restaurable 30 jours, puis supprimé pour de bon. Les endroits qui l&apos;utilisaient retrouvent leur motif à la restauration.</p>
          <ul className="a-wp-trash">
            {trashed.map((w) => (
              <li key={w.id} data-wallpaper-id={w.id}>
                <Preview src={w.thumb} size={w.size} opacity={w.opacity} compact />
                <span className="a-wp-trash-name">
                  {w.name}
                  <small>{w.deletedAt ? `${daysLeft(w.deletedAt)} ${plural(daysLeft(w.deletedAt), "jour restant", "jours restants")}` : ""}</small>
                </span>
                <button
                  type="button"
                  className="a-btn a-btn-small"
                  data-testid="wallpaper-restore"
                  onClick={() =>
                    void restoreWallpaperAction(w.id).then((r) => {
                      if (!r.ok) return toast(r.message, "error");
                      toast(`Restauré · « ${w.name} »`);
                      router.refresh();
                    })
                  }
                >
                  Restaurer
                </button>
                <PurgeItem kind="wallpaper" id={w.id} name={w.name} lost="le fichier est effacé ; les endroits qui l'utilisaient perdent leur motif." />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={target !== null}
        title={target ? `Supprimer le papier peint « ${target.w.name} » ?` : ""}
        confirmLabel="Mettre à la corbeille"
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setTarget(null)}
      >
        {target && target.uses.length > 0 ? (
          <div data-testid="wallpaper-delete-uses">
            <p>
              Ce motif est utilisé à {target.uses.length} endroit{target.uses.length > 1 ? "s" : ""} :
            </p>
            <ul>
              {target.uses.map((u, i) => (
                <li key={i}>{labelOf(u)}</li>
              ))}
            </ul>
            <p>Ces endroits perdront leur motif (ils retrouvent leur couleur, ou le papier du site). Tu pourras le restaurer pendant 30 jours depuis la corbeille.</p>
          </div>
        ) : (
          <p>Il ira à la corbeille, restaurable pendant 30 jours.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
