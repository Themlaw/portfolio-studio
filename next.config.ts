import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** En-têtes de sécurité communs à toutes les réponses. */
const SECURITY_HEADERS = [
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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // En LOW_MEM, le typecheck tourne AVANT le build (`tsc --noEmit` dans
  // build:local), pas en parallèle du serveur de build : même garantie, pic réduit.
  ...(LOW_MEM ? { typescript: { ignoreBuildErrors: true } } : {}),
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // CSP minimale du site public. /admin reçoit une CSP complète (nonce)
      // posée par src/proxy.ts ; /media garde la sienne (sandbox).
      {
        source: "/:path((?!admin(?:/|$)|media/).*)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
      // Aperçu en direct de l'éditeur de thème : en draft mode seulement (cookie
      // posé par /admin/apercu pour un admin connecté), le site public peut
      // s'afficher dans un cadre DE LA MÊME ORIGINE. Les visiteurs (sans ce
      // cookie) gardent DENY / frame-ancestors 'none'. Règle déclarée en
      // dernier : elle remplace les deux en-têtes ci-dessus.
      {
        source: "/:path((?!admin(?:/|$)|media/|api/).*)",
        has: [{ type: "cookie", key: "__prerender_bypass" }],
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
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
  outputFileTracingExcludes: { "*": ["./data/**"] },
  experimental: {
    // Cache ISR en mémoire seulement : sur disque, Next écrirait les pages
    // dans .next/server/app, en lecture seule dans le conteneur (--read-only).
    // Le cache est perdu au redémarrage : les pages sont re-rendues à la
    // première visite (lectures SQLite, quelques ms).
    isrFlushToDisk: false,
    // forbidden() (403) pour les server actions et routes de l'admin sans session.
    authInterrupts: true,
    ...(LOW_MEM ? { cpus: 1, workerThreads: false } : {}),
  },
  images: {
    // Le contenu est composé de SVG : l'optimiseur n'a rien à y gagner.
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
