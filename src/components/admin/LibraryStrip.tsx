"use client";

/**
 * Bandeau « Bibliothèque » de la planche : rangée de vignettes de 72 px (les
 * plus récentes d'abord par défaut ; menu « Trier par », lot 112) qui défile
 * horizontalement (molette comprise, chargement progressif), filtrée par tags (ET) et
 * par recherche. Chaque vignette se glisse dans la bande (dnd-kit, contexte
 * partagé avec la planche) ou s'ajoute à la fin d'un clic. Un média en
 * conversion se place (son emplacement montre l'état) ; un média en échec, non.
 */
import { useDraggable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import TagInput from "@/app/admin/_fields/TagInput";
import type { AdminMediaRow } from "@/lib/admin";
import { tagKey } from "@/lib/tag-key";

import { MediaSortMenu, noDate, sortMedia, useMediaSort, loadMoreOnFocus, useProgressive, useReimportReveal, useTakenDates, useWheelToHorizontal, type MediaSort } from "./media-sort";
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

function Thumb({ media, onAddEnd, sort, flash }: { media: AdminMediaRow; onAddEnd: (m: AdminMediaRow) => void; sort: MediaSort; flash: boolean }) {
  const t = useTranslations("media");
  const failed = media.status === "failed";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${LIB_PREFIX}${media.id}`, data: { media }, disabled: failed });
  const ratio = media.width && media.height ? media.width / media.height : 4 / 3;
  const state = media.status === "processing" ? (media.kind === "video" ? t("converting") : t("processing")) : failed ? t("failed") : null;
  return (
    <li className="a-libthumb" data-status={media.status} data-dragging={isDragging || undefined} data-flash={flash || undefined}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        // Glisser à la souris ou au doigt ; au clavier, le bouton « + » ajoute à la fin.
        tabIndex={-1}
        className="a-libthumb-drag"
        title={failed ? t("thumbFailedTitle", { name: media.name }) : t("thumbDragTitle", { name: media.name })}
        style={{ width: Math.round(THUMB_H * Math.min(2.4, Math.max(0.5, ratio))), backgroundColor: media.color ?? undefined }}
        data-media={media.id}
      >
        {media.thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.thumb} alt="" draggable={false} />
        )}
        {media.kind === "video" && <span className="a-libthumb-kind" aria-hidden="true">▶</span>}
        {state && <span className="a-libthumb-state">{state}</span>}
        {noDate(media, sort) && <span className="a-libthumb-state" data-testid="media-nodate">{t("dateUnknown")}</span>}
      </div>
      <button type="button" className="a-libthumb-add" disabled={failed} onClick={() => onAddEnd(media)} aria-label={t("addToEnd", { name: media.name })}>
        +
      </button>
    </li>
  );
}

export default function LibraryStrip({ media, onAddEnd, regionRef }: { media: AdminMediaRow[]; onAddEnd: (m: AdminMediaRow) => void; regionRef?: React.Ref<HTMLElement> }) {
  const t = useTranslations("media");
  const { tags } = useUploadQueue();
  const [filter, setFilter] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const headingId = useId();
  const [sort, setSort] = useMediaSort();
  const dated = useTakenDates(media);
  const list = useMemo(() => sortMedia(filterMedia(dated, filter, query), sort), [dated, filter, query, sort]);
  const [page, sentinelRef] = useProgressive(list.length, `${sort}|${filter.join(",")}|${query}`);
  const rowRef = useRef<HTMLUListElement>(null);
  useWheelToHorizontal(rowRef, list.length > 0);
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  const flash = useReimportReveal(
    media,
    list,
    () => {
      setFilter([]);
      setQuery("");
    },
    (id, index) => {
      page.ensure(index + 1);
      setScrollTo(id);
    },
  );
  useEffect(() => {
    if (scrollTo === null) return;
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>(`[data-media="${scrollTo}"]`);
    if (!row || !el) return;
    // Défilement horizontal de la rangée seulement (la page ne bouge pas).
    row.scrollLeft = Math.max(0, el.offsetLeft - row.clientWidth / 2 + el.offsetWidth / 2);
    setScrollTo(null);
  }, [scrollTo, page.count]);
  // Seuls les tags présents dans la bibliothèque sont proposés au filtre.
  const options = useMemo(() => tags.filter((tag) => tag.count > 0), [tags]);
  return (
    <section ref={regionRef} className="a-libstrip" aria-labelledby={headingId}>
      <div className="a-libstrip-head">
        <h3 id={headingId} className="a-subhead">
          {t("library")}
        </h3>
        <span className="muted">
          {list.length === media.length ? t("itemCount", { count: media.length }) : t("shownOf", { shown: list.length, total: media.length })}
        </span>
        <div className="a-libstrip-tools">
          <TagInput label={t("filterByTags")} hideLabel mode="filter" value={filter} onChange={setFilter} options={options} />
          <MediaSortMenu
            value={sort}
            onChange={(s) => {
              setSort(s);
              if (rowRef.current) rowRef.current.scrollLeft = 0;
            }}
          />
          <label className="a-search">
            <span className="sr-only">{t("searchLibrary")}</span>
            <input className="a-input" type="search" placeholder={t("searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="muted a-libstrip-empty">{media.length ? t("noMatch") : t("libraryEmpty")}</p>
      ) : (
        <ul ref={rowRef} className="a-libstrip-row" aria-label={t("libraryItems")} tabIndex={0} onFocus={(e) => loadMoreOnFocus(e, page.count, page.more, page.ensure)}>
          {list.slice(0, page.count).map((m) => (
            <Thumb key={m.id} media={m} onAddEnd={onAddEnd} sort={sort} flash={flash === m.id} />
          ))}
          {page.more && <li ref={sentinelRef} className="a-libstrip-more" aria-hidden="true" data-testid="libstrip-more" />}
        </ul>
      )}
      <p className="a-help">{t("stripHelp")}</p>
    </section>
  );
}
