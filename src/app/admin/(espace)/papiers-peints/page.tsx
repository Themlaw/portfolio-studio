import { redirect } from "next/navigation";

import { getThemeOverview } from "@/lib/admin";

export const metadata = { title: "Papiers peints" };

/**
 * L'ancienne page « Papiers peints » (lot 35) est devenue un onglet de l'étape « Papier et motifs » de l'éditeur de thème (lot 61) :
 * l'ancienne adresse y mène (les signets et les liens d'avant continuent de marcher). La bibliothèque ne dépend d'aucun thème : on
 * ouvre l'éditeur du thème en ligne, ou à défaut le premier.
 */
export default function WallpapersPage() {
  const { activeId, themes } = getThemeOverview();
  const target = themes.find((t) => t.id === activeId)?.id ?? themes[0]?.id;
  redirect(target ? `/admin/themes/${encodeURIComponent(target)}?etape=papier&onglet=papiers-peints` : "/admin/themes");
}
