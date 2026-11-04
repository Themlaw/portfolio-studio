import { readFileSync } from "node:fs";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/** Version de l application, pour le manifest des sauvegardes (lot 50). */
let appVersion = "inconnue";
try {
  appVersion = JSON.parse(readFileSync("package.json", "utf8")).version ?? appVersion;
} catch {
  // lancé hors du dossier du projet : version inconnue
}

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** En-têtes de sécurité communs à toutes les réponses. */
const SECURITY_HEADERS = [
  // HTTPS obligatoire pendant un an, sous-domaines compris (ignoré par le navigateur sur une réponse en http : dev, tests).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

/**
 * Build à mémoire réduite (VM de dev, 3,8 Go) : `npm run build:local` pose
 * LOW_MEM_BUILD=1. Un seul worker de génération, sans threads. La CI garde le
 * réglage par défaut (plus rapide).
 */
const LOW_MEM = process.env.LOW_MEM_BUILD === "1";

/**
 * CSP minimale du site public, compatible avec les pages en cache (ISR) : ni nonce ni hachage, seulement ce qui ne dépend pas
 * de la page (docs/SECURITE.md §2.8). Seconde ligne de défense pour le jour où un bloc introduirait une injection : pas de
 * plugin (`object-src`), pas de `<base>` vers un autre site, pas de formulaire envoyé ailleurs. Même suite dans src/proxy.ts
 * (vignettes de l'écran Thèmes). `script-src` avec hachages viendra plus tard.
 */
const PUBLIC_CSP = "object-src 'none'; base-uri 'self'; form-action 'self'";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { PORTFOLIO_VERSION: appVersion },
  // En LOW_MEM, le typecheck tourne AVANT le build (`tsc --noEmit` dans
  // build:local), pas en parallèle du serveur de build : même garantie, pic réduit.
  ...(LOW_MEM ? { typescript: { ignoreBuildErrors: true } } : {}),
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // CSP minimale du site public. /admin reçoit une CSP complète (nonce)
      // posée par src/proxy.ts ; /media, /site-icon et /favicon.ico gardent la leur (sandbox).
      {
        source: "/:path((?!admin(?:/|$)|media/|site-icon/|favicon\\.ico$).*)",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'none'; ${PUBLIC_CSP}` }],
      },
      // Aperçu en direct de l'éditeur de thème : en draft mode seulement (cookie
      // posé par /admin/apercu pour un admin connecté), le site public peut
      // s'afficher dans un cadre DE LA MÊME ORIGINE. Les visiteurs (sans ce
      // cookie) gardent DENY / frame-ancestors 'none'. Règle déclarée en
      // dernier : elle remplace les deux en-têtes ci-dessus.
      {
        source: "/:path((?!admin(?:/|$)|media/|api/|site-icon/|favicon\\.ico$).*)",
        has: [{ type: "cookie", key: "__prerender_bypass" }],
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: `frame-ancestors 'self'; ${PUBLIC_CSP}` },
        ],
      },
    ];
  },
  // La médiathèque a changé d'adresse (phase 4b).
  async redirects() {
    return [{ source: "/admin/mediatheque", destination: "/admin/medias", permanent: true }];
  },
  // Serveur autonome minimal (.next/standalone) pour l'image Docker.
  output: "standalone",
  // Accès au serveur de dev à travers le reverse proxy.
  allowedDevOrigins: ["portfolio.example.org"],
  // La base et les médias de dev (./data) ne doivent jamais finir dans le
  // standalone. Cette exclusion couvre les traces des routes ; celle de
  // l'instrumentation (Turbopack) ne l'honore pas : la vraie garantie est
  // .dockerignore (./data absent du contexte de build) + le garde-fou du
  // Dockerfile qui échoue si un data/ apparaît dans le standalone.
  // Données locales (base, médias de dev) et sources : jamais dans le standalone,
  // y compris pour le proxy et l'instrumentation (le motif « * » ne les couvre pas).
  outputFileTracingExcludes: {
    "*": ["./data/**", "./src/**", "./docs/**"],
    middleware: ["./data/**", "./src/**", "./docs/**"],
    proxy: ["./data/**", "./src/**", "./docs/**"],
    instrumentation: ["./data/**", "./src/**", "./docs/**"],
  },
  experimental: {
    // Cache ISR en mémoire seulement : sur disque, Next écrirait les pages
    // dans .next/server/app, en lecture seule dans le conteneur (--read-only).
    // Le cache est perdu au redémarrage : les pages sont re-rendues à la
    // première visite (lectures SQLite, quelques ms).
    isrFlushToDisk: false,
    // forbidden() (403) pour les server actions et routes de l'admin sans session.
    authInterrupts: true,
    // Corps mis en mémoire par le proxy avant toute route (défaut de Next : 10 Mo par requête, même refusée) : 1 Mo, comme la
    // limite des server actions (docs/SECURITE.md N1). Les envois de fichiers (/admin/api) sont hors du proxy et lus en flux.
    proxyClientMaxBodySize: "1mb",
    ...(LOW_MEM ? { cpus: 1, workerThreads: false } : {}),
  },
  images: {
    // Le contenu est composé de SVG : l'optimiseur n'a rien à y gagner.
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
