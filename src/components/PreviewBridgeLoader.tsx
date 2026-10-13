"use client";

/**
 * Charge le pont d'aperçu (et la feuille du surlignage) à part, seulement quand
 * il est rendu (aperçu admin) : rien de l'éditeur dans le CSS du site public
 * (test-auth ED2d).
 */
import dynamic from "next/dynamic";

const PreviewBridge = dynamic(() => import("./PreviewBridge"), { ssr: false });

export default function PreviewBridgeLoader() {
  return <PreviewBridge />;
}
