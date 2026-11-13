"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { TextField } from "@/app/admin/_fields";
import {
  createPageAction,
  deletePageAction,
  renamePageAction,
  reorderMenuAction,
  reorderPagesAction,
  restorePageAction,
  setInMenuAction,
  setPublishedAction,
} from "@/app/admin/(espace)/pages/actions";
import type { AdminPageRow, TrashSummary } from "@/lib/admin";
import { NOT_FOUND_HELP } from "@/lib/special-pages";
import { untranslatedLabel } from "@/lib/translation-gaps";
import { slugify } from "@/lib/slug";
import { daysLeft, lostWithPage, restoredMessage, TRASH_DAYS } from "@/lib/trash";

import { ConfirmDialog, same, toast, undoToast } from "./editing";
import { EmptyTrash, PurgeItem } from "./TrashControls";
import { DragHandle, SortableList } from "./Sortable";

const isHome = (p: AdminPageRow) => p.slug.fr === "" && p.slug.en === "";
const path = (locale: string, slug: string) => (slug ? `/${locale}/${slug}` : `/${locale}`);
/** Adresses d'une page, en petit et en gris sous son titre. */
const addresses = (p: AdminPageRow) => `${path("fr", p.slug.fr)} · ${path("en", p.slug.en)}`;

function PreviewPage({ id, small }: { id: number; small?: boolean }) {
  const t = useTranslations("pagesMgr");
  return (
    <form method="post" action="/admin/apercu" target="_blank">
      <input type="hidden" name="page" value={id} />
      {/* « Quitter l'aperçu » ramène ici. */}
      <input type="hidden" name="retour" value="/admin/pages" />
      <button type="submit" className={`a-btn${small ? " a-btn-small" : ""}`}>
        {t("preview")} <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}

/* ---- Création ------------------------------------------------------------ */

function CreatePage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("pagesMgr");
  const [title, setTitle] = useState({ fr: "", en: "" });
  const [slug, setSlug] = useState({ fr: "", en: "" });
  const [touched, setTouched] = useState({ fr: false, en: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // L'adresse anglaise suit le titre anglais, ou à défaut le titre français (titre anglais facultatif).
  const follow = (t: { fr: string; en: string }, s: { fr: string; en: string }, tc: { fr: boolean; en: boolean }) => ({
    fr: tc.fr ? s.fr : slugify(t.fr),
    en: tc.en ? s.en : slugify(t.en || t.fr),
  });
  const setT = (l: "fr" | "en", v: string) => {
    const next = { ...title, [l]: v };
    setTitle(next);
    setSlug((s) => follow(next, s, touched));
  };
  const reset = () => {
    setTitle({ fr: "", en: "" });
    setSlug({ fr: "", en: "" });
    setTouched({ fr: false, en: false });
    setErrors({});
    setError(null);
  };

  return (
    <ConfirmDialog
      open={open}
      title={t("createTitle")}
      confirmLabel={t("createConfirm")}
      busy={busy}
      onClose={() => {
        reset();
        onClose();
      }}
      onConfirm={() =>
        start(async () => {
          const result = await createPageAction({ title, slug });
          if (!result.ok) {
            setError(result.message);
            setErrors(result.fieldErrors ?? {});
            return;
          }
          toast(t("created"));
          reset();
          // Droit dans l'éditeur visuel : c'est là qu'on compose la page.
          router.push(`/admin/pages/${result.data.id}/editer`);
        })
      }
    >
      <p className="muted">{t("createIntro")}</p>
      <div className="a-form-grid a-section-tight">
        <TextField label={t("titleFr")} value={title.fr} onChange={(v) => setT("fr", v)} error={errors["title.fr"]} placeholder="Carnets" />
        <TextField
          label={t("titleEn")}
          help={t("titleEnHelp")}
          value={title.en}
          onChange={(v) => setT("en", v)}
          error={errors["title.en"]}
          placeholder="Sketchbooks"
        />
        <TextField
          label={t("slugFr")}
          help={t("siteHelp", { path: path("fr", slug.fr || "…") })}
          value={slug.fr}
          onChange={(v) => {
            setTouched((t) => ({ ...t, fr: true }));
            setSlug((s) => ({ ...s, fr: v }));
          }}
          error={errors["slug.fr"]}
        />
        <TextField
          label={t("slugEn")}
          help={t("siteHelp", { path: path("en", slug.en || "…") })}
          value={slug.en}
          onChange={(v) => {
            setTouched((t) => ({ ...t, en: true }));
            setSlug((s) => ({ ...s, en: v }));
          }}
          error={errors["slug.en"]}
        />
      </div>
      {error && <p className="a-alert">{error}</p>}
    </ConfirmDialog>
  );
}

/* ---- Corbeille ------------------------------------------------------------ */

function TrashList({ pages, summary }: { pages: AdminPageRow[]; summary: TrashSummary }) {
  const router = useRouter();
  const t = useTranslations("pagesMgr");
  const format = useFormatter();
  const [busy, start] = useTransition();
  return (
    <section className="a-panel" aria-labelledby="p-corbeille">
      <h2 id="p-corbeille">{t("trashHeading")}</h2>
      <p className="a-help a-panel-intro">
        {t("trashIntro", { days: TRASH_DAYS })}
      </p>
      <EmptyTrash summary={summary} />
      {pages.length === 0 ? (
        <p className="muted" data-testid="corbeille-vide">{t("trashEmpty")}</p>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-table-stack">
            <thead>
              <tr>
                <th scope="col">{t("colPage")}</th>
                <th scope="col">{t("colDeleted")}</th>
                <th scope="col">
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} data-testid="corbeille-ligne">
                  <td data-label={t("colPage")}>
                    <strong>{p.title}</strong>
                    <span className="a-sub">{addresses(p)}</span>
                  </td>
                  <td data-label={t("colDeleted")}>
                    {p.deletedAt ? format.dateTime(new Date(p.deletedAt), { day: "numeric", month: "long" }) : ""}
                    <span className="a-sub">
                      {t("erasedIn", { count: p.deletedAt ? daysLeft(p.deletedAt) : TRASH_DAYS })}
                    </span>
                  </td>
                  <td className="a-row-actions">
                    <button
                      type="button"
                      className="a-btn a-btn-small"
                      disabled={busy}
                      onClick={() =>
                        start(async () => {
                          const r = await restorePageAction(p.id);
                          if (!r.ok) return toast(r.message, "error");
                          toast(restoredMessage(p.title, r.data));
                          router.refresh();
                        })
                      }
                    >
                      {t("restore")}
                    </button>
                    <PurgeItem kind="page" id={p.id} name={p.title} lost={lostWithPage(p.blocks, p.hasDraft)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---- Liste --------------------------------------------------------------- */

type Pending = { kind: "delete"; page: AdminPageRow } | null;

export default function PagesManager({ pages: allPages, trashed, view, summary }: { pages: AdminPageRow[]; trashed: AdminPageRow[]; view: "liste" | "corbeille"; summary: TrashSummary }) {
  const router = useRouter();
  const t = useTranslations("pagesMgr");
  // Pages spéciales (lot 89, « Page introuvable ») : rangées à part, à la fin ; ni menu, ni renommage, ni suppression.
  const basePages = allPages.filter((p) => !p.special);
  const specials = allPages.filter((p) => p.special);
  const menuSaved = basePages.filter((p) => p.navOrder !== null).sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0));
  const [menu, setMenu] = useState(menuSaved);
  const [menuKey, setMenuKey] = useState(JSON.stringify(menuSaved.map((p) => p.id)));
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // Ordre d'affichage des pages (indépendant du menu). État local pour Monter/Descendre.
  const [pageOrder, setPageOrder] = useState(basePages);
  const [pageSourceKey, setPageSourceKey] = useState(JSON.stringify(basePages.map((p) => p.id)));
  const serverPageKey = JSON.stringify(basePages.map((p) => p.id));
  if (serverPageKey !== pageSourceKey) {
    setPageSourceKey(serverPageKey);
    setPageOrder(basePages);
  }
  const pagesDirty = !same(pageOrder.map((p) => p.id), basePages.map((p) => p.id));

  // Renommage en place.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameFr, setRenameFr] = useState("");
  const [renameEn, setRenameEn] = useState("");

  // Liste serveur rafraîchie (router.refresh) : on repart de l'ordre enregistré.
  const serverKey = JSON.stringify(menuSaved.map((p) => p.id));
  if (serverKey !== menuKey) {
    setMenuKey(serverKey);
    setMenu(menuSaved);
  }
  const menuDirty = !same(menu.map((p) => p.id), menuSaved.map((p) => p.id));

  const act = (fn: () => Promise<{ ok: boolean; message?: string; data?: unknown }>, success: string) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.message ?? t("actionFailed"), "error");
      toast(success);
      // Avertissements non bloquants à la mise en ligne (lot 52), comme dans l'éditeur.
      const warn = (result.data as { warnings?: { missingAlt: unknown[]; untranslated: number } } | null | undefined)?.warnings;
      if (warn && warn.missingAlt.length > 0) {
        const n = warn.missingAlt.length;
        toast(t("missingAlt", { count: n }), "success", undefined, 9000);
      }
      if ((warn as { notInMenu?: boolean } | undefined)?.notInMenu) toast(t("notInMenuToast"), "success", undefined, 9000);
      if (warn && warn.untranslated > 0) toast(t("untranslatedToast", { label: untranslatedLabel(warn.untranslated) }), "success", undefined, 9000);
      router.refresh();
    });

  if (view === "corbeille") return <TrashList pages={trashed} summary={summary} />;

  return (
    <>
      <div className="a-toolbar">
        <button type="button" className="a-btn a-btn-primary" onClick={() => setCreating(true)}>
          {t("createTitle")}
        </button>
      </div>

      <section className="a-panel" aria-labelledby="p-menu">
        <h2 id="p-menu">{t("menuHeading")}</h2>
        <p className="a-help a-panel-intro">{t("menuHelp")}</p>
        {menu.length === 0 ? (
          <p className="muted">{t("menuEmpty")}</p>
        ) : (
          <SortableList
            items={menu}
            getId={(p) => String(p.id)}
            getLabel={(p) => p.title || t("untitled")}
            onReorder={setMenu}
            render={(p, i) => (
              <div className="a-sortable-row">
                <DragHandle />
                <span className="a-sortable-pos mono">{i + 1}</span>
                <span className="a-sortable-title">{p.title || <span className="muted">{t("untitled")}</span>}</span>
                {!p.published && <span className="a-tag">{t("notLive")}</span>}
              </div>
            )}
          />
        )}
        <div className="a-savebar a-savebar-inline" data-dirty={menuDirty}>
          <p className="a-save-state" aria-live="polite">
            {menuDirty ? (
              <>
                <span className="a-dot" aria-hidden="true" /> {t("orderDirty")}
              </>
            ) : (
              <>
                <span aria-hidden="true">✓</span> {t("orderSaved")}
              </>
            )}
          </p>
          {menuDirty && (
            <button type="button" className="a-btn" onClick={() => setMenu(menuSaved)} disabled={busy}>
              {t("cancel")}
            </button>
          )}
          <button
            type="button"
            className="a-btn a-btn-primary"
            disabled={!menuDirty || busy}
            onClick={() => act(() => reorderMenuAction(menu.map((p) => p.id)), t("orderToast"))}
          >
            {t("saveOrder")}
          </button>
        </div>
      </section>

      <section className="a-panel" aria-labelledby="p-toutes">
        <h2 id="p-toutes">{t("allHeading")}</h2>
        <div className="a-table-wrap">
          <table className="a-table a-table-stack">
            <thead>
              <tr>
                <th scope="col">{t("colPage")}</th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colMenu")}</th>
                <th scope="col">
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pageOrder.map((p) => (
                <tr key={p.id}>
                  <td data-label={t("colPage")}>
                    {renamingId === p.id ? (
                      <div className="a-form-grid" style={{ gap: "0.25rem" }}>
                        <input
                          className="a-input"
                          data-testid="rename-fr"
                          value={renameFr}
                          onChange={(e) => setRenameFr(e.target.value)}
                          aria-label={t("titleFr")}
                          placeholder={t("titleFr")}
                        />
                        <input
                          className="a-input"
                          data-testid="rename-en"
                          value={renameEn}
                          onChange={(e) => setRenameEn(e.target.value)}
                          aria-label={t("titleEn")}
                          placeholder={t("titleEn")}
                        />
                        <div className="a-row-actions">
                          <button
                            type="button"
                            className="a-btn a-btn-small a-btn-primary"
                            data-testid="rename-save"
                            disabled={busy}
                            onClick={() =>
                              start(async () => {
                                const r = await renamePageAction(p.id, { title: { fr: renameFr, en: renameEn } });
                                if (!r.ok) return toast(r.message ?? t("actionFailed"), "error");
                                toast(t("renamed"));
                                setRenamingId(null);
                                router.refresh();
                              })
                            }
                          >
                            {t("renameConfirm")}
                          </button>
                          <button
                            type="button"
                            className="a-btn a-btn-small"
                            data-testid="rename-cancel"
                            disabled={busy}
                            onClick={() => setRenamingId(null)}
                          >
                            {t("cancel")}
                          </button>
                        </div>
                        <span className="a-sub mono">{addresses(p)}</span>
                      </div>
                    ) : (
                      <>
                        {/* Entrée principale : l'éditeur visuel. */}
                        <Link href={`/admin/pages/${p.id}/editer`} className="a-strong-link">
                          {p.title}
                        </Link>
                        <span className="muted"> · {t("blocks", { count: p.blocks })}</span>
                        {p.hasDraft && (
                          <>
                            {" "}
                            <span className="a-tag a-tag-draft" title={t("unpublishedChangesTitle")}>
                              {t("unpublishedChanges")}
                            </span>
                          </>
                        )}
                        {/* L'adresse reste visible, en petit : le titre est ce qu'on cherche. */}
                        <span className="a-sub mono">{addresses(p)}</span>
                      </>
                    )}
                  </td>
                  <td data-label={t("colState")}>
                    {p.published ? <span className="a-badge">{t("live")}</span> : <span className="a-tag">{t("notLive")}</span>}
                    {p.untranslated > 0 && (
                      <span className="a-tag a-tag-warn" data-testid="untranslated" title={untranslatedLabel(p.untranslated)}>
                        {t("untranslated")}
                      </span>
                    )}
                    {!isHome(p) && (
                      <button
                        type="button"
                        className="a-btn a-btn-small a-btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          act(() => setPublishedAction(p.id, !p.published), p.published ? t("toastOffline", { title: p.title }) : p.hasDraft ? t("toastLiveNoDraft", { title: p.title }) : t("toastLive", { title: p.title }))
                        }
                      >
                        {p.published ? t("takeOffline") : t("putOnline")}
                      </button>
                    )}
                  </td>
                  <td data-label={t("colMenu")}>
                    {p.published && p.navOrder === null && !isHome(p) && (
                      <p className="a-tag a-tag-warn" data-testid="not-in-menu">
                        {t("notInMenu")}
                      </p>
                    )}
                    <button
                      type="button"
                      className="a-btn a-btn-small a-btn-quiet"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => setInMenuAction(p.id, p.navOrder === null),
                          p.navOrder === null ? t("toastAddedMenu", { title: p.title }) : t("toastRemovedMenu", { title: p.title }),
                        )
                      }
                    >
                      {p.navOrder === null ? t("addToMenu") : t("removeFromMenu")}
                    </button>
                  </td>
                  <td className="a-row-actions">
                    <button
                      type="button"
                      className="a-btn a-btn-small"
                      data-testid="page-up"
                      disabled={busy || pageOrder[0]?.id === p.id}
                      onClick={() => {
                        const idx = pageOrder.findIndex((x) => x.id === p.id);
                        if (idx <= 0) return;
                        const next = [...pageOrder];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        setPageOrder(next);
                      }}
                      aria-label={t("moveUp")}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="a-btn a-btn-small"
                      data-testid="page-down"
                      disabled={busy || pageOrder[pageOrder.length - 1]?.id === p.id}
                      onClick={() => {
                        const idx = pageOrder.findIndex((x) => x.id === p.id);
                        if (idx < 0 || idx >= pageOrder.length - 1) return;
                        const next = [...pageOrder];
                        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                        setPageOrder(next);
                      }}
                      aria-label={t("moveDown")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="a-btn a-btn-small a-btn-quiet"
                      data-testid="rename-page"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(p.id);
                        setRenameFr(p.title);
                        setRenameEn(p.titleEn);
                      }}
                    >
                      {t("rename")}
                    </button>
                    <Link className="a-btn a-btn-small" href={`/admin/pages/${p.id}/editer`}>
                      {t("edit")}
                    </Link>
                    <Link className="a-btn a-btn-small a-btn-quiet" href={`/admin/pages/${p.id}`}>
                      {t("pageInfo")}
                    </Link>
                    <PreviewPage id={p.id} small />
                    {!isHome(p) && (
                      <button
                        type="button"
                        className="a-btn a-btn-small a-btn-quiet a-danger-text"
                        onClick={() => {
                          setError(null);
                          setPending({ kind: "delete", page: p });
                        }}
                      >
                        {t("delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="a-savebar a-savebar-inline" data-dirty={pagesDirty}>
          <p className="a-save-state" aria-live="polite">
            {pagesDirty ? (
              <>
                <span className="a-dot" aria-hidden="true" /> {t("pagesOrderDirty")}
              </>
            ) : (
              <>
                <span aria-hidden="true">✓</span> {t("pagesOrderSaved")}
              </>
            )}
          </p>
          {pagesDirty && (
            <button type="button" className="a-btn" onClick={() => setPageOrder(basePages)} disabled={busy}>
              {t("cancel")}
            </button>
          )}
          <button
            type="button"
            className="a-btn a-btn-primary"
            disabled={!pagesDirty || busy}
            onClick={() =>
              start(async () => {
                const r = await reorderPagesAction(pageOrder.map((p) => p.id));
                if (!r.ok) return toast(r.message ?? t("actionFailed"), "error");
                toast(t("pagesOrderToast"));
                router.refresh();
              })
            }
          >
            {t("savePagesOrder")}
          </button>
        </div>
      </section>

      {specials.length > 0 && (
        <section className="a-panel" aria-labelledby="p-speciales" data-testid="pages-speciales">
          <h2 id="p-speciales">{t("specialsHeading")}</h2>
          <p className="a-help a-panel-intro">{t("specialsHelp")}</p>
          <div className="a-table-wrap">
            <table className="a-table a-table-stack">
              <thead>
                <tr>
                  <th scope="col">{t("colPage")}</th>
                  <th scope="col">{t("colState")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("colActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {specials.map((p) => (
                  <tr key={p.id} data-testid="page-speciale">
                    <td data-label={t("colPage")}>
                      <Link href={`/admin/pages/${p.id}/editer`} className="a-strong-link">
                        {p.title}
                      </Link>{" "}
                      <span className="a-badge" data-testid="badge-speciale">
                        {t("specialBadge")}
                      </span>
                      <span className="muted"> · {t("blocks", { count: p.blocks })}</span>
                      {p.hasDraft && (
                        <>
                          {" "}
                          <span className="a-tag a-tag-draft" title={t("unpublishedChangesTitle")}>
                            {t("unpublishedChanges")}
                          </span>
                        </>
                      )}
                      <span className="a-sub" data-testid="aide-speciale">
                        {NOT_FOUND_HELP}
                      </span>
                    </td>
                    <td data-label={t("colState")}>
                      {p.published ? <span className="a-badge">{t("live")}</span> : <span className="a-tag">{t("notLive")}</span>}
                      <button
                        type="button"
                        className="a-btn a-btn-small a-btn-quiet"
                        disabled={busy}
                        title={p.published ? t("specialOfflineTitle") : undefined}
                        onClick={() => act(() => setPublishedAction(p.id, !p.published), p.published ? t("toastSpecialOffline", { title: p.title }) : t("toastLive", { title: p.title }))}
                      >
                        {p.published ? t("takeOffline") : t("putOnline")}
                      </button>
                    </td>
                    <td className="a-row-actions">
                      <Link className="a-btn a-btn-small" href={`/admin/pages/${p.id}/editer`}>
                        {t("edit")}
                      </Link>
                      <PreviewPage id={p.id} small />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <CreatePage open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={pending?.kind === "delete"}
        title={t("deleteTitle", { title: pending?.page.title ?? "" })}
        confirmLabel={t("delete")}
        danger
        busy={busy}
        // Jamais « Supprimer » proposé pour un refus annoncé : tant que d'autres blocs la montrent, le bouton est inactif.
        confirmDisabled={(pending?.page.blockedBy.length ?? 0) > 0}
        onClose={() => setPending(null)}
        onConfirm={() =>
          pending &&
          start(async () => {
            const page = pending.page;
            const result = await deletePageAction(page.id);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setPending(null);
            undoToast(page.title, () =>
              void restorePageAction(page.id).then((r) => {
                if (!r.ok) return toast(r.message, "error");
                toast(restoredMessage(page.title, r.data));
                router.refresh();
              }),
            );
            router.refresh();
          })
        }
      >
        {pending && pending.page.blockedBy.length > 0 ? (
          <div className="a-alert" role="alert" data-testid="suppression-bloquee">
            <p>
              {t("blockedIntro", { count: pending.page.blockedBy.length })}
            </p>
            <ul className="a-refs">
              {pending.page.blockedBy.map((r, i) => (
                <li key={i}>
                  {t.rich("blockRef", {
                    type: r.blockType,
                    title: r.pageTitle,
                    l: (c) => <Link href={r.trashed ? "/admin/pages?vue=corbeille" : `/admin/pages/${r.pageId}/editer`}>{c}</Link>,
                  })}
                  {r.trashed && <span className="muted">{t("inTrash")}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">
            {t("deleteKeep", { days: TRASH_DAYS })}
            {pending?.page.hasDraft && ` ${t("draftKept")}`}
          </p>
        )}
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
