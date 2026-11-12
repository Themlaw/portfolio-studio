"use client";

/**
 * Tri et défilement de la bibliothèque dans l'éditeur (lot 112) : onglet Médias de l'éditeur visuel ET bandeau Bibliothèque de la
 * planche partagent ce module : le même menu « Trier par », la même préférence, la même lecture paresseuse des dates, le même
 * chargement progressif (aucune image inaccessible) et la même mise en évidence d'un fichier renvoyé qui existait déjà.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { backfillTakenAction } from "@/app/admin/(espace)/medias/actions";
import type { AdminMediaRow } from "@/lib/admin";

import { toast } from "./editing";
import { useUploadQueue } from "./UploadQueue";

export type MediaSort = "added-desc" | "added-asc" | "name-asc" | "name-desc" | "taken-desc" | "taken-asc";

/** `labelKey` : clé du libellé dans le catalogue `media`. */
export const SORTS: { id: MediaSort; labelKey: string }[] = [
  { id: "added-desc", labelKey: "sortAddedDesc" },
  { id: "added-asc", labelKey: "sortAddedAsc" },
  { id: "name-asc", labelKey: "sortNameAsc" },
  { id: "name-desc", labelKey: "sortNameDesc" },
  { id: "taken-desc", labelKey: "sortTakenDesc" },
  { id: "taken-asc", labelKey: "sortTakenAsc" },
];
const DEFAULT_SORT: MediaSort = "added-desc";
const STORE = "pf.editor.mediaSort";
const isSort = (v: unknown): v is MediaSort => SORTS.some((s) => s.id === v);

const byName = (a: AdminMediaRow, b: AdminMediaRow) => a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" });

/** Médias triés (copie). Dates de création inconnues : à la fin, dans les deux sens. Égalité : l'identifiant, dans le sens du tri. */
export function sortMedia(list: AdminMediaRow[], sort: MediaSort): AdminMediaRow[] {
  const asc = sort.endsWith("asc");
  const dir = asc ? 1 : -1;
  const out = [...list];
  out.sort((a, b) => {
    let c = 0;
    if (sort.startsWith("added")) c = a.importedAt - b.importedAt;
    else if (sort.startsWith("name")) c = byName(a, b);
    else {
      if (a.takenAt === null || b.takenAt === null) return a.takenAt === b.takenAt ? b.id - a.id : a.takenAt === null ? 1 : -1;
      c = a.takenAt - b.takenAt;
    }
    return c !== 0 ? c * dir : (a.id - b.id) * dir;
  });
  return out;
}

/** Choix de tri mémorisé par navigateur (préférence d'éditeur : ni dans le contenu, ni publiée). */
export function useMediaSort(): [MediaSort, (s: MediaSort) => void] {
  const [sort, setSort] = useState<MediaSort>(DEFAULT_SORT);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reprise unique, après le montage : le stockage n'existe pas côté serveur.
      if (isSort(v)) setSort(v);
    } catch {
      /* stockage indisponible : défaut */
    }
  }, []);
  const change = useCallback((s: MediaSort) => {
    setSort(s);
    try {
      localStorage.setItem(STORE, s);
    } catch {
      /* ignoré */
    }
  }, []);
  return [sort, change];
}

/**
 * Dates de création des médias anciens : lues en tâche de fond par petits lots (métadonnées de l'original, côté serveur), sans
 * bloquer l'éditeur. Renvoie les médias avec les dates déjà lues.
 */
export function useTakenDates(media: AdminMediaRow[]): AdminMediaRow[] {
  const [filled, setFilled] = useState<Map<number, number | null>>(new Map());
  const pending = useMemo(() => media.some((m) => !m.takenChecked && !filled.has(m.id)), [media, filled]);
  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const timer = setTimeout(async () => {
      for (let guard = 0; guard < 200 && !stop; guard++) {
        const r = await backfillTakenAction().catch(() => null);
        if (!r || !r.ok || stop) return;
        if (r.data.done.length)
          setFilled((cur) => {
            const next = new Map(cur);
            for (const d of r.data.done) next.set(d.id, d.takenAt);
            return next;
          });
        if (r.data.remaining === 0 || r.data.done.length === 0) return;
      }
    }, 600);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // Une seule boucle tant qu'il reste des médias non lus : `pending` change seulement quand tout est lu.
  }, [pending]);
  return useMemo(() => (filled.size ? media.map((m) => (!m.takenChecked && filled.has(m.id) ? { ...m, takenAt: filled.get(m.id) ?? null, takenChecked: true } : m)) : media), [media, filled]);
}

/** Menu « Trier par » (même libellés partout). */
export function MediaSortMenu({ value, onChange, className }: { value: MediaSort; onChange: (s: MediaSort) => void; className?: string }) {
  const t = useTranslations("media");
  return (
    <label className={`a-sortmenu${className ? ` ${className}` : ""}`}>
      <span className="a-sortmenu-label">{t("sortBy")}</span>
      <select className="a-input" value={value} onChange={(e) => onChange(e.target.value as MediaSort)} data-testid="media-sort">
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {t(s.labelKey)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Date de création inconnue, à signaler quand on trie par date de création. */
export const noDate = (m: AdminMediaRow, sort: MediaSort): boolean => sort.startsWith("taken") && m.takenChecked && m.takenAt === null;

export const PAGE = 60;

/**
 * Chargement progressif sans limite : `count` éléments rendus ; tant que la sentinelle (posée après le dernier) est visible, la
 * suite est ajoutée. `reset` (changement de tri ou de filtre) ramène à la première page. `ensure(n)` en force au moins n.
 */
export function useProgressive(total: number, reset: unknown) {
  const [state, setState] = useState({ reset, count: PAGE });
  const [node, setNode] = useState<HTMLElement | null>(null);
  // Changement de tri ou de filtre : retour à la première page (état dérivé pendant le rendu).
  if (!Object.is(state.reset, reset)) setState({ reset, count: PAGE });
  const count = Object.is(state.reset, reset) ? state.count : PAGE;
  const setCount = useCallback((f: (c: number) => number) => setState((s) => ({ ...s, count: f(s.count) })), []);
  useEffect(() => {
    if (!node || count >= total || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setCount((c) => c + PAGE), { rootMargin: "300px" });
    io.observe(node);
    return () => io.disconnect();
  }, [node, count, total, setCount]);
  const ensure = useCallback((n: number) => setCount((c) => Math.max(c, n + PAGE / 2)), [setCount]);
  // Le deuxième élément se pose en `ref` de la sentinelle.
  return [{ count: Math.min(count, total), more: count < total, ensure }, setNode] as const;
}

/** Clavier : le focus approche de la fin de ce qui est rendu → la suite est chargée avant que Tab ne quitte la liste. */
export function loadMoreOnFocus(e: React.FocusEvent<HTMLElement>, count: number, more: boolean, ensure: (n: number) => void) {
  if (!more) return;
  const li = (e.target as HTMLElement).closest("li");
  if (li && Array.prototype.indexOf.call(e.currentTarget.children, li) >= count - 12) ensure(count + PAGE / 2);
}

/**
 * Souris : la molette verticale fait défiler une rangée horizontale (sinon seul le pavé tactile ou Maj + molette le permettaient).
 * Aux extrémités, la molette reprend son rôle (la page défile).
 */
export function useWheelToHorizontal(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.min(max, Math.max(0, el.scrollLeft + e.deltaY));
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, active]);
}

/**
 * Fichier renvoyé qui existait déjà (la file d'envoi l'indique : `reused`) : message, filtres levés, puis, une fois le média remonté
 * en tête de « Ajouté récemment » (données rechargées), `reveal(id, rang)` le fait défiler dans la vue ; `flash` = son id pendant
 * quelques secondes (mise en évidence).
 */
export function useReimportReveal(media: AdminMediaRow[], shown: AdminMediaRow[], clearFilters: () => void, reveal: (id: number, index: number) => void): number | null {
  const queue = useUploadQueue();
  const t = useTranslations("media");
  const tRef = useRef(t);
  const [pending, setPending] = useState<{ id: number; at: number | null } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const clearRef = useRef(clearFilters);
  const revealRef = useRef(reveal);
  useEffect(() => {
    clearRef.current = clearFilters;
    revealRef.current = reveal;
    tRef.current = t;
  });
  useEffect(
    () =>
      queue.onMediaCreated((_item, m) => {
        if (!m.reused) return;
        toast(tRef.current("alreadyInLibrary", { name: m.name }), "success");
        clearRef.current();
        setPending({ id: m.id, at: m.importedAt ?? null });
      }),
    [queue],
  );
  useEffect(() => {
    if (!pending) return;
    const row = media.find((x) => x.id === pending.id);
    // Données pas encore rechargées (ancienne date), ou filtres pas encore levés : on attend le rendu suivant.
    if (!row || (pending.at !== null && row.importedAt < pending.at)) return;
    const index = shown.findIndex((x) => x.id === pending.id);
    if (index < 0) return;
    revealRef.current(pending.id, index);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- suit l'arrivée des données rechargées du serveur (le média remonté).
    setPending(null);
    setFlash(pending.id);
  }, [pending, media, shown]);
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(timer);
  }, [flash]);
  return flash;
}
