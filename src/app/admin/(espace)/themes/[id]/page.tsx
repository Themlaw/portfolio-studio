import Link from "next/link";
import { notFound } from "next/navigation";

import PageHeader from "@/components/admin/PageHeader";
import ThemeEditor from "@/components/admin/ThemeEditor";
import { getThemeOverview } from "@/lib/admin";
import { FONT_VARIABLE_CLASSES } from "@/themes/fonts";

export const metadata = { title: "Modifier un thème" };

export default async function ThemeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { activeId, themes } = getThemeOverview();
  const theme = themes.find((t) => t.id === id);
  if (!theme) notFound();
  if (theme.preset) {
    return (
      <>
        <PageHeader title={theme.name} intro="Thème livré avec le site." />
        <div className="a-empty">
          <h2>Un thème livré ne se modifie pas</h2>
          <p>Duplique-le depuis la liste des thèmes, puis modifie la copie : l&apos;original reste disponible.</p>
          <p style={{ marginTop: 12 }}>
            <Link className="a-btn" href="/admin/themes">
              Retour aux thèmes
            </Link>
          </p>
        </div>
      </>
    );
  }
  return (
    // Classes next/font : les échantillons de typographies s'affichent dans leur police.
    <div className={FONT_VARIABLE_CLASSES}>
      <PageHeader
        title={theme.name}
        intro={
          theme.id === activeId
            ? "Ce thème est en ligne : chaque enregistrement est visible aussitôt par tes visiteurs."
            : "Ce thème n'est pas en ligne : tes réglages ne sont visibles que dans l'aperçu."
        }
      />
      <ThemeEditor initial={theme} isActive={theme.id === activeId} />
    </div>
  );
}
