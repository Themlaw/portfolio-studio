"use client";

import { createContext, useContext } from "react";

import type { BlockEditorProps } from "./editor-types";

/**
 * Bloc en cours d'édition, fourni par l'éditeur de page autour de l'éditeur
 * du type (élément sans props transmis par le serveur depuis le registre).
 */
export const BlockEditorContext = createContext<BlockEditorProps | null>(null);

export function useBlockEditor(): BlockEditorProps {
  const value = useContext(BlockEditorContext);
  if (!value) throw new Error("useBlockEditor : à utiliser dans l'éditeur de page");
  return value;
}
