"use client";

/**
 * Choix d'un réseau (v0.13.1) — UNE implémentation partagée par la toile
 * (« + Réseau » du profil et du pied, SiteLayer) et l'écran Réglages
 * (SocialsEditor) : réseaux classiques ou « Autre lien », adresse reconnue
 * (le réseau est déduit de l'adresse collée, sans la réécrire), adresse
 * e-mail convertie en `mailto:`, contrôle `safeSocialHref`.
 *
 * Aucun style propre : chaque écran passe ses classes (`classes`), la toile
 * celles de la couche d'édition, l'admin les siennes (jetons --admin-*).
 */
import { useState } from "react";

import { detectNetwork, NETWORK_LABELS, NETWORKS, safeSocialHref, type Network } from "@/lib/site-schema";

import SocialIcon from "./SocialIcon";

export const CLASSIC_NETWORKS = NETWORKS.filter((n) => n !== "other");

export type SocialPickerClasses = {
  title: string;
  grid: string;
  form: string;
  field: string;
  hint: string;
  error: string;
  button: string;
  back?: string;
};

export type SocialPicked = { href: string; label: string; network: Network };

export default function SocialPicker({
  mode,
  initialHref = "",
  initialLabel = "",
  editLabel = false,
  classes,
  onDone,
}: {
  /** « add » : menu des réseaux puis adresse ; « edit » : adresse (et nom si `editLabel`). */
  mode: "add" | "edit";
  initialHref?: string;
  initialLabel?: string;
  /** Modifier aussi le nom affiché (Réglages ; sur la toile, il se modifie en place). */
  editLabel?: boolean;
  classes: SocialPickerClasses;
  onDone: (value: SocialPicked) => void;
}) {
  const [network, setNetwork] = useState<Network | null>(mode === "edit" ? (detectNetwork(initialHref) ?? "other") : null);
  const [href, setHref] = useState(initialHref === "#" ? "" : initialHref);
  const [label, setLabel] = useState(initialLabel);
  const detected = href.trim() ? detectNetwork(href.trim()) : null;
  // Adresse collée : le réseau est reconnu (l'adresse saisie n'est pas réécrite).
  const effective: Network | null = network === "other" || network === null ? (detected && detected !== "website" ? detected : network) : network;
  const asEmail = effective === "email" && href.trim() && !href.trim().startsWith("mailto:") && href.includes("@") ? `mailto:${href.trim()}` : href.trim();
  const ok = safeSocialHref(asEmail);
  const name = label.trim() || (effective && effective !== "other" ? NETWORK_LABELS[effective] : "");
  const withLabel = mode === "add" || editLabel;

  if (mode === "add" && !network) {
    return (
      <>
        <p className={classes.title}>Ajouter un réseau</p>
        <ul className={classes.grid} role="menu" aria-label="Réseaux">
          {CLASSIC_NETWORKS.map((n) => (
            <li key={n} role="none">
              <button type="button" role="menuitem" onClick={() => setNetwork(n)}>
                <SocialIcon kind={n} /> {NETWORK_LABELS[n]}
              </button>
            </li>
          ))}
          <li role="none">
            <button type="button" role="menuitem" onClick={() => setNetwork("other")}>
              <SocialIcon kind="other" /> Autre lien
            </button>
          </li>
        </ul>
      </>
    );
  }
  const submit = () => {
    if (!ok || (withLabel && !name)) return;
    onDone({ href: asEmail, label: name.slice(0, 40), network: effective ?? "other" });
  };
  return (
    // Pas de <form> : le picker peut vivre dans un formulaire (Réglages).
    <div
      className={classes.form}
      role="group"
      aria-label={mode === "edit" ? "Modifier le lien" : "Nouveau réseau"}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }
      }}
    >
      <p className={classes.title}>
        {effective && <SocialIcon kind={effective} />} {mode === "edit" ? "Modifier le lien" : effective && effective !== "other" ? NETWORK_LABELS[effective] : "Autre lien"}
      </p>
      <label className={classes.field}>
        <span>{effective === "email" ? "Adresse e-mail" : "Adresse du profil"}</span>
        <input
          type="text"
          autoFocus
          maxLength={300}
          placeholder={effective === "email" ? "nom@domaine.fr" : "https://…"}
          value={href}
          onChange={(e) => setHref(e.target.value)}
          aria-invalid={href.trim() !== "" && !ok}
        />
      </label>
      {detected && detected !== "website" && network === "other" && <small className={classes.hint}>Reconnu : {NETWORK_LABELS[detected]}</small>}
      {withLabel && (
        <label className={classes.field}>
          <span>Nom affiché{effective && effective !== "other" ? " (facultatif)" : ""}</span>
          <input type="text" maxLength={40} placeholder={effective && effective !== "other" ? NETWORK_LABELS[effective] : "Ex. Mon blog"} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      )}
      {href.trim() && !ok && <small className={classes.error}>Adresse invalide : https://… seulement (ou une adresse e-mail).</small>}
      <span>
        {mode === "add" && classes.back !== undefined && (
          <button type="button" className={classes.back} onClick={() => setNetwork(null)}>
            ← Autre réseau
          </button>
        )}
        <button type="button" className={classes.button} disabled={!ok || (withLabel && !name)} onClick={submit}>
          {mode === "edit" ? "Enregistrer le lien" : "Ajouter"}
        </button>
      </span>
    </div>
  );
}
