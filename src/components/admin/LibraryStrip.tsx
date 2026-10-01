"use client";

/**
 * Bandeau « Bibliothèque » de la planche : rangée de vignettes de 72 px (les
 * plus récentes d'abord) qui défile horizontalement, filtrée par tags (ET) et
 * par recherche. Chaque vignette se glisse dans la bande (dnd-kit, contexte
 * partagé avec la planche) ou s'ajoute à la fin d'un clic. Un média en
 * conversion se place (son emplacement montre l'état) ; un média en échec, non.
 */
import { useDraggable } from "@dnd-kit/core";
import { useId, useMemo, useState } from "react";

import TagInput from "@/app/admin/_fields/TagInput";
import type { AdminMediaRow } from "@/lib/admin";
import { tagKey } from "@/lib/tag-key";

import { useUploadQueue } from "./UploadQueue";

export const LIB_PREFIX = "lib-";
const THUMB_H = 72;

/** Médias correspondant à tous les tags du filtre (ET) et à la recherche (nom ou tag). */
export function filterMedia(media: AdminMediaRow[], tags: string[], query: string): AdminMediaRow[] {
  const wanted = tags.map(tagKey);
  const q = tagKey(query);
  return media.filter((m) => {
    const keys = m.tags.map((t) => tagKey(t.label));
    if (!wanted.every((w) => keys.includes(w))) return false;
    return !q || tagKey(m.name).includes(q) || keys.some((k) => k.includes(q));
  });
}

function Thumb({ media, onAddEnd }: { media: AdminMediaRow; onAddEnd: (m: AdminMediaRow) => void }) {
  const failed = media.status === "failed";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${LIB_PREFIX}${media.id}`, data: { media }, disabled: failed });
  const ratio = media.width && media.height ? media.width / media.height : 4 / 3;
  const state = media.status === "processing" ? (media.kind === "video" ? "Conversion…" : "Traitement…") : failed ? "Échec" : null;
  return (
    <li className="a-libthumb" data-status={media.status} data-dragging={isDragging || undefined}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        // Glisser à la souris ou au doigt ; au clavier, le bouton « + » ajoute à la fin.
        tabIndex={-1}
        className="a-libthumb-drag"
        title={failed ? `${media.name} : en échec, ne peut pas être placé` : `${media.name} : glisse dans la bande`}
        style={{ width: Math.round(THUMB_H * Math.min(2.4, Math.max(0.5, ratio))), backgroundColor: media.color ?? undefined }}
        data-media={media.id}
      >
        {media.thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.thumb} alt="" draggable={false} />
        )}
        {media.kind === "video" && <span className="a-libthumb-kind" aria-hidden="true">▶</span>}
        {state && <span className="a-libthumb-state">{state}</span>}
      </div>
      <button type="button" className="a-libthumb-add" disabled={failed} onClick={() => onAddEnd(media)} aria-label={`Ajouter ${media.name} à la fin de la planche`}>
        +
      </button>
    </li>
  );
}

export default function LibraryStrip({ media, onAddEnd, regionRef }: { media: AdminMediaRow[]; onAddEnd: (m: AdminMediaRow) => void; regionRef?: React.Ref<HTMLElement> }) {
  const { tags } = useUploadQueue();
  const [filter, setFilter] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const headingId = useId();
  const list = useMemo(() => filterMedia(media, filter, query), [media, filter, query]);
  // Seuls les tags présents dans la bibliothèque sont proposés au filtre.
  const options = useMemo(() => tags.filter((t) => t.count > 0), [tags]);
  return (
    <section ref={regionRef} className="a-libstrip" aria-labelledby={headingId}>
      <div className="a-libstrip-head">
        <h3 id={headingId} className="a-subhead">
          Bibliothèque
        </h3>
        <span className="muted">
          {list.length === media.length ? `${media.length} média${media.length > 1 ? "s" : ""}` : `${list.length} sur ${media.length}`}
        </span>
        <div className="a-libstrip-tools">
          <TagInput label="Filtrer par tags" hideLabel mode="filter" value={filter} onChange={setFilter} options={options} />
          <label className="a-search">
            <span className="sr-only">Rechercher dans la bibliothèque</span>
            <input className="a-input" type="search" placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="muted a-libstrip-empty">{media.length ? "Aucun média ne correspond à ce filtre." : "Ta bibliothèque est vide : envoie des fichiers ci-dessus."}</p>
      ) : (
        <ul className="a-libstrip-row" aria-label="Médias de la bibliothèque">
          {list.map((m) => (
            <Thumb key={m.id} media={m} onAddEnd={onAddEnd} />
          ))}
        </ul>
      )}
      <p className="a-help">Fais glisser une vignette dans la bande, entre deux emplacements ou sur un emplacement vide ; « + » l&apos;ajoute à la fin.</p>
    </section>
  );
}
