"use client";

/**
 * Réglages de l'en-tête et du pied de page dans l'éditeur visuel (v0.13) :
 * nom du site, métier, e-mail, mention, liens du menu, réseaux. Données
 * COMMUNES à toutes les pages : brouillon du site, publié avec la page
 * (src/lib/edit/site.ts). Mêmes champs que l'écran Réglages.
 *
 * `siteText` / `applySiteOp` : modifications venues de la toile (texte en
 * place, ×, glisser, « + Ajouter un lien », « + Réseau »), contrôlées par le
 * même schéma que le serveur avant tout envoi.
 */
import { useId } from "react";

import { Toggle } from "@/app/admin/_fields";
import SocialsEditor from "@/components/admin/SocialsEditor";

import type { FromCanvas } from "@/lib/edit/protocol";
import { editedKind, NETWORKS, SiteSnapSchema, socialKind, type Network, type SiteSnap } from "@/lib/site-schema";

type Result = { snap: SiteSnap; done?: string } | { error: string };
type Page = { id: number; title: string };

function checked(snap: SiteSnap, done?: string): Result {
  const parsed = SiteSnapSchema.safeParse(snap);
  return parsed.success ? { snap: parsed.data, ...(done ? { done } : {}) } : { error: parsed.error.issues[0]?.message ?? "Valeur invalide." };
}
const clone = (s: SiteSnap): SiteSnap => JSON.parse(JSON.stringify(s));
function moved<T>(list: T[], from: number, to: number): T[] | null {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return null;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Texte de l'en-tête ou du pied modifié en place. */
export function siteText(snap: SiteSnap, msg: Extract<FromCanvas, { kind: "site-text" }>): Result {
  const next = clone(snap);
  const value = msg.value.trim();
  switch (msg.field) {
    case "name":
      // Le nom français est obligatoire ; l'anglais vide reprend le français.
      if (!value && msg.locale === "fr") return { error: "Le nom du site ne peut pas être vide." };
      next.identity.name = { ...next.identity.name, [msg.locale]: value.slice(0, 80) };
      break;
    case "email":
      next.identity.email = value;
      break;
    case "role":
    case "credit":
      next.identity[msg.field] = { ...next.identity[msg.field], [msg.locale]: value.slice(0, 160) };
      break;
    case "nav": {
      const item = msg.index !== undefined ? next.nav[msg.index] : undefined;
      if (!item) return { error: "Ce lien n'existe plus : recharge l'éditeur." };
      if (item.kind === "link") {
        if (!value) return { error: "Le texte d'un lien ne peut pas être vide." };
        item.label = { ...item.label, [msg.locale]: value.slice(0, 60) };
      } else {
        // Vide : le lien reprend le titre de la page.
        const label = { fr: item.label?.fr ?? "", en: item.label?.en ?? "", [msg.locale]: value.slice(0, 60) };
        if (label.fr || label.en) item.label = label;
        else delete item.label;
      }
      break;
    }
  }
  return checked(next);
}

/** Opération sur le menu ou les réseaux venue de la toile. */
export function applySiteOp(snap: SiteSnap, msg: Extract<FromCanvas, { kind: "site-op" }>, pages: Page[]): Result {
  const next = clone(snap);
  switch (msg.op) {
    case "nav-remove":
      if (!next.nav[msg.index]) return { error: "Ce lien n'existe plus." };
      next.nav.splice(msg.index, 1);
      return checked(next, "Lien retiré du menu");
    case "nav-move": {
      const list = moved(next.nav, msg.index, msg.to);
      if (!list) return { error: "Déplacement impossible." };
      next.nav = list;
      return checked(next);
    }
    case "nav-add-page": {
      if (!pages.some((p) => p.id === msg.pageId)) return { error: "Cette page n'existe plus." };
      if (next.nav.some((i) => i.kind === "page" && i.pageId === msg.pageId)) return { error: "Cette page est déjà dans le menu." };
      next.nav.push({ kind: "page", pageId: msg.pageId });
      return checked(next, "Lien ajouté au menu");
    }
    case "nav-add-link":
      next.nav.push({ kind: "link", href: msg.href, label: { fr: msg.label, en: msg.label } });
      return checked(next, "Lien ajouté au menu");
    case "social-remove":
      if (!next.socials[msg.index]) return { error: "Ce réseau n'existe plus." };
      next.socials.splice(msg.index, 1);
      return checked(next, "Réseau retiré");
    case "social-move": {
      const list = moved(next.socials, msg.index, msg.to);
      if (!list) return { error: "Déplacement impossible." };
      next.socials = list;
      return checked(next);
    }
    case "social-edit": {
      const s = next.socials[msg.index];
      if (!s) return { error: "Ce réseau n'existe plus." };
      s.href = msg.href;
      const kind = editedKind(s.kind, msg.href);
      if (kind) s.kind = kind;
      return checked(next, "Lien du réseau modifié");
    }
    case "social-add": {
      const network = (NETWORKS as readonly string[]).includes(msg.network) ? (msg.network as Network) : "other";
      next.socials.push({ label: msg.label, href: msg.href, kind: socialKind(network, msg.href) });
      return checked(next, "Réseau ajouté");
    }
  }
}

/** Champ texte enregistré à la sortie du champ (pas une écriture par frappe). */
function Text({ label, value, onCommit, placeholder, help, type = "text" }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; help?: string; type?: string }) {
  const id = useId();
  return (
    <div className="a-field">
      <label className="a-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        key={value}
        type={type}
        className="a-input"
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {help && <p className="a-help">{help}</p>}
    </div>
  );
}

export default function SiteEditor({
  which,
  snap,
  pages,
  locked,
  onChange,
}: {
  which: "header" | "footer";
  snap: SiteSnap;
  pages: Page[];
  locked: string | null;
  onChange: (next: SiteSnap) => void;
}) {
  const set = (fn: (s: SiteSnap) => void) => {
    const next = clone(snap);
    fn(next);
    if (SiteSnapSchema.safeParse(next).success) onChange(next);
  };
  const title = (id: number) => pages.find((p) => p.id === id)?.title ?? `page ${id}`;
  const free = pages.filter((p) => !snap.nav.some((i) => i.kind === "page" && i.pageId === p.id));
  return (
    <div className="ve-settings" data-testid="site-editor">
      <header className="ve-settings-head">
        <h2>{which === "header" ? "En-tête" : "Pied de page"}</h2>
      </header>
      <p className="ve-site-note">
        <strong>Commun à toutes les pages.</strong> Ces changements restent en brouillon avec cette page et s&apos;appliquent à tout le site quand tu
        la publies.
      </p>
      {locked && <p className="a-field-error">En cours de modification sur la page « {locked} » : publie-la ou abandonne-la d&apos;abord.</p>}
      <fieldset disabled={Boolean(locked)} className="ve-site-fields">
        <Text label="Nom du site (FR)" value={snap.identity.name.fr} onCommit={(v) => v.trim() && set((s) => void (s.identity.name.fr = v.trim()))} help="Logo de l'en-tête, ouverture, profil, pied de page, titre des pages." />
        <Text label="Nom du site (EN)" value={snap.identity.name.en} placeholder={snap.identity.name.fr} onCommit={(v) => set((s) => void (s.identity.name.en = v.trim()))} help="Vide : le nom français est repris." />
        <Text label="Métier (FR)" value={snap.identity.role.fr} onCommit={(v) => set((s) => void (s.identity.role.fr = v))} />
        <Text label="Métier (EN)" value={snap.identity.role.en} onCommit={(v) => set((s) => void (s.identity.role.en = v))} />
        {which === "footer" && (
          <>
            <Text label="E-mail" type="email" value={snap.identity.email} onCommit={(v) => set((s) => void (s.identity.email = v.trim()))} />
            <Text label="Mention (FR)" value={snap.identity.credit.fr} onCommit={(v) => set((s) => void (s.identity.credit.fr = v))} />
            <Text label="Mention (EN)" value={snap.identity.credit.en} onCommit={(v) => set((s) => void (s.identity.credit.en = v))} />
          </>
        )}

        <h3 className="ve-sub">Menu</h3>
        <ol className="ve-list">
          {snap.nav.map((item, i) => (
            <li key={`${item.kind}-${item.kind === "page" ? item.pageId : item.href}-${i}`} className="ve-list-row">
              <span className="ve-list-main">
                <Text
                  label={item.kind === "page" ? `Lien vers « ${title(item.pageId)} » (FR)` : `Lien libre ${item.href} (FR)`}
                  value={item.label?.fr ?? ""}
                  placeholder={item.kind === "page" ? title(item.pageId) : ""}
                  onCommit={(v) =>
                    set((s) => {
                      const it = s.nav[i];
                      if (it.kind === "page") it.label = { fr: v, en: it.label?.en ?? "" };
                      else it.label = { ...it.label, fr: v };
                    })
                  }
                />
              </span>
              <span className="ve-list-tools">
                <button type="button" className="a-icon-btn" aria-label="Monter" disabled={i === 0} onClick={() => set((s) => void (s.nav = moved(s.nav, i, i - 1) ?? s.nav))}>
                  ↑
                </button>
                <button type="button" className="a-icon-btn" aria-label="Descendre" disabled={i === snap.nav.length - 1} onClick={() => set((s) => void (s.nav = moved(s.nav, i, i + 1) ?? s.nav))}>
                  ↓
                </button>
                <button type="button" className="a-icon-btn a-danger-text" aria-label="Retirer du menu" onClick={() => set((s) => void s.nav.splice(i, 1))}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
        {free.length > 0 && (
          <div className="a-field">
            <label className="a-label" htmlFor="ve-nav-add">
              Ajouter une page au menu
            </label>
            <select id="ve-nav-add" className="a-input a-select" value="" onChange={(e) => e.target.value && set((s) => void s.nav.push({ kind: "page", pageId: Number(e.target.value) }))}>
              <option value="">— Choisir une page —</option>
              {free.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <h3 className="ve-sub">Réseaux</h3>
        {which === "header" && (
          <Toggle
            label="Icônes des réseaux dans l'en-tête"
            help="Avant FR / EN, icônes seules ; dans le menu sur téléphone."
            checked={snap.identity.headerSocials === true}
            onChange={(on) =>
              set((s) => {
                // Décoché ≡ absent (forme canonique, src/lib/site-schema.ts) : pas de brouillon fantôme.
                if (on) s.identity.headerSocials = true;
                else delete s.identity.headerSocials;
              })
            }
          />
        )}
        <SocialsEditor items={snap.socials} onChange={(socials) => set((s) => void (s.socials = socials))} disabled={Boolean(locked)} />
        <p className="ve-hint">Sur la page : survole un lien ou un réseau pour le retirer ou le déplacer, « + Ajouter un lien » et « + Réseau » pour en ajouter.</p>
      </fieldset>
    </div>
  );
}
