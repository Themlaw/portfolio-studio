"use client";

/**
 * Commandes et avis de la toile de l'éditeur pour les entrées d'une collection (lots 22, 26, 48, 105, 117 ; textes d'admin : lot 130b).
 * Composants client rendus à l'intérieur d'<EditOnly> (CollectionTiles reste un composant sans hook) : ils lisent le catalogue d'admin
 * (AdminIntlBoundary), pas celui du site public.
 */
import { useTranslations } from "next-intl";

/** Monter / descendre / retirer une entrée (mode « à la main »). */
export function TileToolbar({ index, itemCount }: { index: number; itemCount: number }) {
  const t = useTranslations("canvasTiles");
  return (
    <span className="pe-tile-tools" role="group" aria-label={t("entry")}>
      <button type="button" data-edit-tile-op="up" data-index={index} disabled={index === 0} aria-label={t("up")} title={t("up")}>↑</button>
      <button type="button" data-edit-tile-op="down" data-index={index} disabled={index >= itemCount - 1} aria-label={t("down")} title={t("down")}>↓</button>
      <button type="button" data-edit-tile-op="remove" data-index={index} className="pe-danger" aria-label={t("remove")} title={t("remove")}>✕</button>
    </span>
  );
}

/** Couverture (lot 26), depuis la tuile : choisir une image, ou revenir à celle de la collection. */
export function TileCover({ title, itemIndex, pageId, ownCover }: { title: string; itemIndex: number | undefined; pageId: number | undefined; ownCover: boolean }) {
  const t = useTranslations("canvasTiles");
  return (
    <span className="pe-tile-cover" role="group" aria-label={t("coverGroup", { title })}>
      <button type="button" data-edit-tile-op="cover" data-index={itemIndex} data-page-id={pageId} title={t("coverTitle")}>
        {t("coverChange")}
      </button>
      {ownCover && (
        <button type="button" data-edit-tile-op="cover-clear" data-index={itemIndex} data-page-id={pageId} title={t("coverClearTitle")}>
          {t("coverClear")}
        </button>
      )}
    </span>
  );
}

/** Avis d'une entrée qui n'apparaît pas sur le site (page retirée, sans image, collection vide). */
export function TileNote({ kind, title, pageId, collectionName }: { kind: "broken" | "noimage" | "empty"; title?: string; pageId?: number; collectionName?: string }) {
  const t = useTranslations("canvasTiles");
  if (kind === "broken") return <>{t("broken")}</>;
  if (kind === "noimage") return <>{t("noImage", { title: title || t("pageFallback", { id: pageId ?? 0 }) })}</>;
  const name = title || collectionName || "";
  return (
    <>
      {t("emptyHead")}{" "}
      <span className="pe-tile-empty-why">{collectionName ? t("emptyWhyNamed", { tile: name, collection: collectionName }) : t("emptyWhy", { tile: name })}</span>
    </>
  );
}

/** « + Ajouter une entrée » sous les entrées (mode « à la main »). */
export function TileAddRow({ candidates, disabled, hasCandidates }: { candidates: { pageId: number; title: string }[]; disabled: boolean; hasCandidates: boolean }) {
  const t = useTranslations("canvasTiles");
  return (
    <div className="pe-tile-add-row">
      <button type="button" className="pe-tile-add" data-edit-tile-add="" data-candidates={JSON.stringify(candidates)} disabled={disabled}>
        {t("addEntry")}
      </button>
      {!hasCandidates && <span className="pe-tile-add-note">{t("allUsed")}</span>}
    </div>
  );
}
