"use client";

/**
 * Charge la couche d'édition (et sa feuille de style) à part, seulement
 * quand elle est rendue (vue brouillon de l'admin) : rien de l'éditeur dans
 * le JavaScript ni le CSS du site public.
 */
import dynamic from "next/dynamic";

const EditLayer = dynamic(() => import("./EditLayer"), { ssr: false });

export default function EditLayerLoader() {
  return <EditLayer />;
}
