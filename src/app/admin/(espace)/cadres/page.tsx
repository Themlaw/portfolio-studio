import FrameLibrary from "@/components/admin/FrameLibrary";
import PageHeader from "@/components/admin/PageHeader";
import { listFramesForAdmin, themeFrameInfo } from "@/lib/frames";

export const metadata = { title: "Cadres" };

/** Bibliothèque de cadres (lot 74), sœur de « Papiers peints » : mêmes composants, mêmes gestes. */
export default function FramesPage() {
  return (
    <>
      <PageHeader
        title="Cadres"
        intro="Tes cadres dessinés, à poser autour d'une photo ou d'une vidéo. Importe-en autant que tu veux (PNG ou WebP sur fond transparent, ou SVG), puis choisis-en un dans le menu « Cadre » de chaque image."
      />
      <FrameLibrary initial={listFramesForAdmin()} theme={themeFrameInfo()} />
    </>
  );
}
