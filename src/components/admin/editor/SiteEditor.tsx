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
import { useTranslations } from "next-intl";
import { useId } from "react";

import { Toggle } from "@/app/admin/_fields";
import SocialsEditor from "@/components/admin/SocialsEditor";

import type { AdminT } from "@/i18n/admin-lang";
import type { FromCanvas } from "@/lib/edit/protocol";
import { editedKind, navKeyOf, NETWORKS, SiteSnapSchema, socialKind, socialKeys, uniqueKeys, type Network, type SiteSnap } from "@/lib/site-schema";

type Result = { snap: SiteSnap; done?: string } | { error: string };
type Page = { id: number; title: string };

function checked(snap: SiteSnap, t: AdminT, done?: string): Result {
  const parsed = SiteSnapSchema.safeParse(snap);
  return parsed.success ? { snap: parsed.data, ...(done ? { done } : {}) } : { error: parsed.error.issues[0]?.message ?? t("invalid") };
}
const clone = (s: SiteSnap): SiteSnap => JSON.parse(JSON.stringify(s));
/**
 * Rang visé : la clé stable de l'élément (menu : page ou adresse ; réseau : nom et adresse) quand la toile en
 * donne une, sinon le rang envoyé. Un rang compte les aperçus en attente de la toile : si l'un d'eux a été
 * refusé, il ne désigne plus le même élément. -1 : l'élément n'existe plus.
 */
function rankFor(keys: string[], index: number | undefined, key: string | undefined): number {
  return key !== undefined ? keys.indexOf(key) : (index ?? -1);
}
const navKeysOf = (snap: SiteSnap) => uniqueKeys(snap.nav.map((i) => navKeyOf(i.kind === "page" ? { pageId: i.pageId, href: "" } : { href: i.href })));
function moved<T>(list: T[], from: number, to: number): T[] | null {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return null;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Texte de l'en-tête ou du pied modifié en place. */
/** `t` : traducteur de l'espace « editorPanelsSite » (messages affichés dans la bulle de l'éditeur). */
export function siteText(snap: SiteSnap, msg: Extract<FromCanvas, { kind: "site-text" }>, t: AdminT): Result {
  const next = clone(snap);
  const value = msg.value.trim();
  switch (msg.field) {
    case "name":
      // Le nom français est obligatoire ; l'anglais vide reprend le français.
      if (!value && msg.locale === "fr") return { error: t("nameEmpty") };
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
      const item = next.nav[rankFor(navKeysOf(next), msg.index, msg.key)];
      if (!item) return { error: t("linkGoneReload") };
      if (item.kind === "link") {
        if (!value) return { error: t("linkLabelEmpty") };
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
  return checked(next, t);
}

/** Opération sur le menu ou les réseaux venue de la toile. */
export function applySiteOp(snap: SiteSnap, msg: Extract<FromCanvas, { kind: "site-op" }>, pages: Page[], t: AdminT): Result {
  const next = clone(snap);
  switch (msg.op) {
    case "nav-remove": {
      const at = rankFor(navKeysOf(next), msg.index, msg.key);
      if (!next.nav[at]) return { error: t("linkGone") };
      next.nav.splice(at, 1);
      return checked(next, t, t("linkRemoved"));
    }
    case "nav-move": {
      const list = moved(next.nav, rankFor(navKeysOf(next), msg.index, msg.key), msg.to);
      if (!list) return { error: t("moveImpossible") };
      next.nav = list;
      return checked(next, t);
    }
    case "nav-add-page": {
      if (!pages.some((p) => p.id === msg.pageId)) return { error: t("pageGone") };
      if (next.nav.some((i) => i.kind === "page" && i.pageId === msg.pageId)) return { error: t("pageInMenu") };
      next.nav.push({ kind: "page", pageId: msg.pageId });
      return checked(next, t, t("linkAdded"));
    }
    case "nav-add-link":
      next.nav.push({ kind: "link", href: msg.href, label: { fr: msg.label, en: msg.label } });
      return checked(next, t, t("linkAdded"));
    case "social-remove": {
      const at = rankFor(socialKeys(next.socials), msg.index, msg.key);
      if (!next.socials[at]) return { error: t("socialGone") };
      next.socials.splice(at, 1);
      return checked(next, t, t("socialRemoved"));
    }
    case "social-move": {
      const list = moved(next.socials, rankFor(socialKeys(next.socials), msg.index, msg.key), msg.to);
      if (!list) return { error: t("moveImpossible") };
      next.socials = list;
      return checked(next, t);
    }
    case "social-edit": {
      const s = next.socials[rankFor(socialKeys(next.socials), msg.index, msg.key)];
      if (!s) return { error: t("socialGone") };
      s.href = msg.href;
      const kind = editedKind(s.kind, msg.href);
      if (kind) s.kind = kind;
      return checked(next, t, t("socialEdited"));
    }
    case "social-add": {
      const network = (NETWORKS as readonly string[]).includes(msg.network) ? (msg.network as Network) : "other";
      next.socials.push({ label: msg.label, href: msg.href, kind: socialKind(network, msg.href) });
      return checked(next, t, t("socialAdded"));
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
  onChange,
}: {
  which: "header" | "footer";
  snap: SiteSnap;
  pages: Page[];
  /** La modification est appliquée par l'éditeur au dernier état écrit (pas à `snap`, peut-être en retard). */
  onChange: (change: (s: SiteSnap) => void) => void;
}) {
  const t = useTranslations("editorPanelsSite");
  const set = onChange;
  const title = (id: number) => pages.find((p) => p.id === id)?.title ?? t("pageFallback", { id });
  const free = pages.filter((p) => !snap.nav.some((i) => i.kind === "page" && i.pageId === p.id));
  return (
    <div className="ve-settings" data-testid="site-editor">
      <header className="ve-settings-head">
        <h2>{which === "header" ? t("header") : t("footer")}</h2>
      </header>
      <p className="ve-site-note">
        <strong>{t("commonBold")}</strong> {t("commonNote")}
      </p>
      <fieldset className="ve-site-fields">
        <Text label={t("nameFr")} value={snap.identity.name.fr} onCommit={(v) => v.trim() && set((s) => void (s.identity.name.fr = v.trim()))} help={t("nameHelp")} />
        <Text label={t("nameEn")} value={snap.identity.name.en} placeholder={snap.identity.name.fr} onCommit={(v) => set((s) => void (s.identity.name.en = v.trim()))} help={t("nameEnHelp")} />
        <Text label={t("roleFr")} value={snap.identity.role.fr} onCommit={(v) => set((s) => void (s.identity.role.fr = v))} />
        <Text label={t("roleEn")} value={snap.identity.role.en} onCommit={(v) => set((s) => void (s.identity.role.en = v))} />
        {which === "footer" && (
          <>
            <Text label={t("email")} type="email" value={snap.identity.email} onCommit={(v) => set((s) => void (s.identity.email = v.trim()))} />
            <Text label={t("creditFr")} value={snap.identity.credit.fr} onCommit={(v) => set((s) => void (s.identity.credit.fr = v))} />
            <Text label={t("creditEn")} value={snap.identity.credit.en} onCommit={(v) => set((s) => void (s.identity.credit.en = v))} />
          </>
        )}

        <h3 className="ve-sub">{t("menu")}</h3>
        <ol className="ve-list">
          {snap.nav.map((item, i) => (
            <li key={`${item.kind}-${item.kind === "page" ? item.pageId : item.href}-${i}`} className="ve-list-row">
              <span className="ve-list-main">
                <Text
                  label={item.kind === "page" ? t("linkToPage", { title: title(item.pageId) }) : t("freeLink", { href: item.href })}
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
                <button type="button" className="a-icon-btn" aria-label={t("up")} disabled={i === 0} onClick={() => set((s) => void (s.nav = moved(s.nav, i, i - 1) ?? s.nav))}>
                  ↑
                </button>
                <button type="button" className="a-icon-btn" aria-label={t("down")} disabled={i === snap.nav.length - 1} onClick={() => set((s) => void (s.nav = moved(s.nav, i, i + 1) ?? s.nav))}>
                  ↓
                </button>
                <button type="button" className="a-icon-btn a-danger-text" aria-label={t("removeFromMenu")} onClick={() => set((s) => void s.nav.splice(i, 1))}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
        {free.length > 0 && (
          <div className="a-field">
            <label className="a-label" htmlFor="ve-nav-add">
              {t("addPage")}
            </label>
            <select id="ve-nav-add" className="a-input a-select" value="" onChange={(e) => e.target.value && set((s) => void s.nav.push({ kind: "page", pageId: Number(e.target.value) }))}>
              <option value="">{t("choosePage")}</option>
              {free.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <h3 className="ve-sub">{t("networks")}</h3>
        {which === "header" && (
          <Toggle
            label={t("headerSocials")}
            help={t("headerSocialsHelp")}
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
        <SocialsEditor items={snap.socials} onChange={(socials) => set((s) => void (s.socials = socials))} />
        <p className="ve-hint">{t("onPage")}</p>
      </fieldset>
    </div>
  );
}
