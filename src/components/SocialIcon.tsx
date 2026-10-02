import { detectNetwork, NETWORK_LABELS, type Network } from "@/lib/site-schema";

import { BRAND_ICONS } from "./social-icons";

/**
 * Icône d'un réseau : tracé SVG embarqué (src/components/social-icons.ts,
 * extrait de simple-icons, CC0 — seulement les réseaux proposés), couleur du
 * texte (currentColor : suit le thème). Aucune requête externe. Réseau sans
 * tracé de marque : pictogramme maison (LinkedIn, Cara) ou générique (lien,
 * globe, enveloppe).
 */
const GENERIC: Record<"email" | "website" | "other", string> = {
  email: "M2 5h20v14H2V5zm2 2v.5l8 5.2 8-5.2V7H4zm16 2.9-8 5.2-8-5.2V17h16V9.9z",
  website:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4a13.8 13.8 0 0 1 1.9 4h-3.8A13.8 13.8 0 0 1 12 4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6A15.7 15.7 0 0 0 8.1 8zM12 20a13.8 13.8 0 0 1-1.9-4h3.8A13.8 13.8 0 0 1 12 20zm2.3-6H9.7a14.6 14.6 0 0 1 0-4h4.6a14.6 14.6 0 0 1 0 4zm.2 5.6a15.7 15.7 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z",
  other:
    "M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a3 3 0 0 1 4.2 4.2l-2.1 2.1-1.4-1.4 2.1-2.1a1 1 0 0 0-1.4-1.4L12 13.4a1 1 0 0 1-1.4 0zm2.8-2.8a1 1 0 0 1 0 1.4l-3.5 3.5a3 3 0 0 1-4.2-4.2l2.1-2.1 1.4 1.4-2.1 2.1a1 1 0 0 0 1.4 1.4L12 10.6a1 1 0 0 1 1.4 0z",
};

/** Réseau d'un lien sans `kind` (données d'avant v0.13) : d'après son nom, puis son adresse. */
export function networkOf(label: string, href: string): Network {
  const byLabel = (Object.entries(NETWORK_LABELS) as [Network, string][]).find(([, l]) => l.toLowerCase().startsWith(label.trim().toLowerCase()) && label.trim().length > 1);
  return byLabel?.[0] ?? detectNetwork(href) ?? "other";
}

/**
 * Pictogrammes maison (absents de simple-icons) : dessin simple, sans copie
 * d'un logo déposé. Tracés en « evenodd » (les formes intérieures sont évidées).
 * LinkedIn : « in » dans un carré arrondi. Cara : un « c » dans un cercle.
 */
const CUSTOM: Partial<Record<Network, string>> = {
  linkedin:
    "M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm2.1 3.6a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM5.6 10.2v8.3h3v-8.3h-3zm4.9 0v8.3h3v-4.4c0-1.3.6-2 1.6-2s1.4.7 1.4 2v4.4h3v-5c0-2.6-1.4-3.6-3.3-3.6-1.3 0-2.2.6-2.7 1.4v-1.1h-3z",
  cara: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm3.9 6.3A5.2 5.2 0 0 0 6.8 12a5.2 5.2 0 0 0 9.1 3.7l-2-1.7A2.6 2.6 0 0 1 9.4 12a2.6 2.6 0 0 1 4.5-1.9l2-1.8z",
};

export default function SocialIcon({ kind, label = "", href = "", className = "" }: { kind?: Network; label?: string; href?: string; className?: string }) {
  const k = kind ?? networkOf(label, href);
  const custom = CUSTOM[k];
  const path = custom || BRAND_ICONS[k] || GENERIC[k === "email" || k === "website" ? k : "other"];
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" className={`social-icon ${className}`} fill="currentColor">
      <path d={path} fillRule={custom ? "evenodd" : undefined} />
    </svg>
  );
}
