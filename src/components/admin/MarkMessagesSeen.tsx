"use client";

import { useEffect } from "react";

import { markMessagesSeenAction } from "@/app/admin/(espace)/messages/actions";

/**
 * Arrivée sur la page Messages = les messages sont vus (lot 52) : la pastille du menu et la carte du tableau de bord
 * repartent à zéro. Rien n'est rafraîchi ici : la page garde ses repères « Nouveau » jusqu'à ce qu'on la quitte.
 */
export default function MarkMessagesSeen({ upTo }: { upTo: number }) {
  useEffect(() => {
    if (upTo > 0) void markMessagesSeenAction(upTo);
  }, [upTo]);
  return null;
}
