import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
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
  },
  images: {
    // Le contenu est composé de SVG : l'optimiseur n'a rien à y gagner.
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
