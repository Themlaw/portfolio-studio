"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { TextField } from "@/app/admin/_fields";
import {
  createPageAction,
  deletePageAction,
  reorderMenuAction,
  restorePageAction,
  setInMenuAction,
  setPublishedAction,
} from "@/app/admin/(espace)/pages/actions";
import type { AdminPageRow, TrashSummary } from "@/lib/admin";
import { slugify } from "@/lib/slug";
import { daysLeft, TRASH_DAYS } from "@/lib/trash";

import { ConfirmDialog, same, toast, undoToast } from "./editing";
import { EmptyTrash, PurgeItem } from "./TrashControls";
import { DragHandle, SortableList } from "./Sortable";

const isHome = (p: AdminPageRow) => p.slug.fr === "" && p.slug.en === "";
const path = (locale: string, slug: string) => (slug ? `/${locale}/${slug}` : `/${locale}`);
/** Adresses d'une page, en petit et en gris sous son titre. */
const addresses = (p: AdminPageRow) => `${path("fr", p.slug.fr)} · ${path("en", p.slug.en)}`;

function PreviewPage({ id, small }: { id: number; small?: boolean }) {
  return (
    <form method="post" action="/admin/apercu" target="_blank">
      <input type="hidden" name="page" value={id} />
      {/* « Quitter l'aperçu » ramène ici. */}
      <input type="hidden" name="retour" value="/admin/pages" />
      <button type="submit" className={`a-btn${small ? " a-btn-small" : ""}`}>
        Prévisualiser <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}

/* ---- Création ------------------------------------------------------------ */

function CreatePage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
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
      title="Créer une page"
      confirmLabel="Créer la page"
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
          toast("Page créée · pas encore publiée");
          reset();
          // Droit dans l'éditeur visuel : c'est là qu'on compose la page.
          router.push(`/admin/pages/${result.data.id}/editer`);
        })
      }
    >
      <p className="muted">La page est créée sans être publiée : tu la composes dans l&apos;éditeur, puis tu la publies quand elle est prête.</p>
      <div className="a-form-grid a-section-tight">
        <TextField label="Titre en français" value={title.fr} onChange={(v) => setT("fr", v)} error={errors["title.fr"]} placeholder="Carnets" />
        <TextField
          label="Titre en anglais"
          help="Facultatif : le titre français sinon."
          value={title.en}
          onChange={(v) => setT("en", v)}
          error={errors["title.en"]}
          placeholder="Sketchbooks"
        />
        <TextField
          label="Adresse en français"
          help={`Ton site${path("fr", slug.fr || "…")}`}
          value={slug.fr}
          onChange={(v) => {
            setTouched((t) => ({ ...t, fr: true }));
            setSlug((s) => ({ ...s, fr: v }));
          }}
          error={errors["slug.fr"]}
        />
        <TextField
          label="Adresse en anglais"
          help={`Ton site${path("en", slug.en || "…")}`}
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
  const [busy, start] = useTransition();
  return (
    <section className="a-panel" aria-labelledby="p-corbeille">
      <h2 id="p-corbeille">Pages supprimées</h2>
      <p className="a-help a-panel-intro">
        Une page supprimée n&apos;est plus sur le site ni dans le menu. Elle reste {TRASH_DAYS} jours ici : restaure-la en un clic, après quoi elle est effacée pour de bon.
      </p>
      <EmptyTrash summary={summary} />
      {pages.length === 0 ? (
        <p className="muted" data-testid="corbeille-vide">La corbeille est vide.</p>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-table-stack">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Supprimée</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} data-testid="corbeille-ligne">
                  <td data-label="Page">
                    <strong>{p.title}</strong>
                    <span className="a-sub">{addresses(p)}</span>
                  </td>
                  <td data-label="Supprimée">
                    {p.deletedAt ? new Date(p.deletedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : ""}
                    <span className="a-sub">
                      effacée dans {p.deletedAt ? daysLeft(p.deletedAt) : TRASH_DAYS} jour{p.deletedAt && daysLeft(p.deletedAt) < 2 ? "" : "s"}
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
                          toast(r.data.slugChanged ? `« ${p.title} » restaurée · son adresse était prise, elle en a une nouvelle` : `« ${p.title} » restaurée`);
                          router.refresh();
                        })
                      }
                    >
                      Restaurer
                    </button>
                    <PurgeItem kind="page" id={p.id} name={p.title} lost={`ses ${p.blocks} rubrique${p.blocks > 1 ? "s" : ""} et son brouillon disparaissent.`} />
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

export default function PagesManager({ pages, trashed, view, summary }: { pages: AdminPageRow[]; trashed: AdminPageRow[]; view: "liste" | "corbeille"; summary: TrashSummary }) {
  const router = useRouter();
  const menuSaved = pages.filter((p) => p.navOrder !== null).sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0));
  const [menu, setMenu] = useState(menuSaved);
  const [menuKey, setMenuKey] = useState(JSON.stringify(menuSaved.map((p) => p.id)));
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // Liste serveur rafraîchie (router.refresh) : on repart de l'ordre enregistré.
  const serverKey = JSON.stringify(menuSaved.map((p) => p.id));
  if (serverKey !== menuKey) {
    setMenuKey(serverKey);
    setMenu(menuSaved);
  }
  const menuDirty = !same(menu.map((p) => p.id), menuSaved.map((p) => p.id));

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.message ?? "L'action a échoué.", "error");
      toast(success);
      router.refresh();
    });

  if (view === "corbeille") return <TrashList pages={trashed} summary={summary} />;

  return (
    <>
      <div className="a-toolbar">
        <button type="button" className="a-btn a-btn-primary" onClick={() => setCreating(true)}>
          Créer une page
        </button>
      </div>

      <section className="a-panel" aria-labelledby="p-menu">
        <h2 id="p-menu">Ordre du menu</h2>
        <p className="a-help a-panel-intro">
          Fais glisser les pages par leur poignée, ou utilise le clavier : Espace pour saisir, flèches pour déplacer, Espace
          pour poser.
        </p>
        {menu.length === 0 ? (
          <p className="muted">Aucune page dans le menu.</p>
        ) : (
          <SortableList
            items={menu}
            getId={(p) => String(p.id)}
            getLabel={(p) => p.title}
            onReorder={setMenu}
            render={(p, i) => (
              <div className="a-sortable-row">
                <DragHandle />
                <span className="a-sortable-pos mono">{i + 1}</span>
                <span className="a-sortable-title">{p.title}</span>
                {!p.published && <span className="a-tag">Non publiée</span>}
              </div>
            )}
          />
        )}
        <div className="a-savebar a-savebar-inline" data-dirty={menuDirty}>
          <p className="a-save-state" aria-live="polite">
            {menuDirty ? (
              <>
                <span className="a-dot" aria-hidden="true" /> Nouvel ordre non enregistré
              </>
            ) : (
              <>
                <span aria-hidden="true">✓</span> Ordre enregistré
              </>
            )}
          </p>
          {menuDirty && (
            <button type="button" className="a-btn" onClick={() => setMenu(menuSaved)} disabled={busy}>
              Annuler
            </button>
          )}
          <button
            type="button"
            className="a-btn a-btn-primary"
            disabled={!menuDirty || busy}
            onClick={() => act(() => reorderMenuAction(menu.map((p) => p.id)), "Ordre du menu enregistré")}
          >
            Enregistrer l&apos;ordre
          </button>
        </div>
      </section>

      <section className="a-panel" aria-labelledby="p-toutes">
        <h2 id="p-toutes">Toutes les pages</h2>
        <div className="a-table-wrap">
          <table className="a-table a-table-stack">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">État</th>
                <th scope="col">Menu</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id}>
                  <td data-label="Page">
                    {/* Entrée principale : l'éditeur visuel. */}
                    <Link href={`/admin/pages/${p.id}/editer`} className="a-strong-link">
                      {p.title}
                    </Link>
                    <span className="muted"> · {p.blocks} rubrique{p.blocks > 1 ? "s" : ""}</span>
                    {p.hasDraft && (
                      <>
                        {" "}
                        <span className="a-tag a-tag-draft" title="Des modifications de l'éditeur ne sont pas encore publiées.">
                          Brouillon non publié
                        </span>
                      </>
                    )}
                    {/* L'adresse reste visible, en petit : le titre est ce qu'on cherche. */}
                    <span className="a-sub mono">{addresses(p)}</span>
                  </td>
                  <td data-label="État">
                    {p.published ? <span className="a-badge">Publiée</span> : <span className="a-tag">Non publiée</span>}
                    {!isHome(p) && (
                      <button
                        type="button"
                        className="a-btn a-btn-small a-btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          act(() => setPublishedAction(p.id, !p.published), p.published ? `« ${p.title} » dépubliée` : `« ${p.title} » publiée`)
                        }
                      >
                        {p.published ? "Dépublier" : "Publier"}
                      </button>
                    )}
                  </td>
                  <td data-label="Menu">
                    <button
                      type="button"
                      className="a-btn a-btn-small a-btn-quiet"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => setInMenuAction(p.id, p.navOrder === null),
                          p.navOrder === null ? `« ${p.title} » ajoutée au menu` : `« ${p.title} » retirée du menu`,
                        )
                      }
                    >
                      {p.navOrder === null ? "Ajouter au menu" : "Retirer du menu"}
                    </button>
                  </td>
                  <td className="a-row-actions">
                    <Link className="a-btn a-btn-small" href={`/admin/pages/${p.id}/editer`}>
                      Modifier
                    </Link>
                    <Link className="a-btn a-btn-small a-btn-quiet" href={`/admin/pages/${p.id}`}>
                      Infos de la page
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
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CreatePage open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={pending?.kind === "delete"}
        title={`Supprimer la page « ${pending?.page.title ?? ""} » ?`}
        confirmLabel="Supprimer"
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
                toast(`« ${page.title} » restaurée`);
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
              Cette page est utilisée par {pending.page.blockedBy.length} rubrique{pending.page.blockedBy.length > 1 ? "s" : ""} : retire ces liens avant de la supprimer.
            </p>
            <ul className="a-refs">
              {pending.page.blockedBy.map((r, i) => (
                <li key={i}>
                  Rubrique « {r.blockType} » de la page <Link href={r.trashed ? "/admin/pages?vue=corbeille" : `/admin/pages/${r.pageId}/editer`}>{r.pageTitle}</Link>
                  {r.trashed && <span className="muted"> (à la corbeille)</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">
            Elle quitte le site et le menu, mais reste {TRASH_DAYS} jours dans la corbeille : tu peux l&apos;y retrouver ou annuler juste après.
            {pending?.page.hasDraft && " Son brouillon de l'éditeur est conservé ; ses modifications non publiées de planches ou de l'en-tête (réseaux, pied de page) sont abandonnées."}
          </p>
        )}
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
