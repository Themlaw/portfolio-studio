import Picture from "@/components/Picture";
import Video from "@/components/Video";
import type { HeroBackground } from "@/components/hero/types";

/**
 * Image ou vidéo de fond choisie dans l'éditeur (parallax et projecteur). La
 * boîte `.hero-backdrop` (posée par l'appelant) reçoit le cadrage (look.css) ;
 * le média la remplit en « cover ».
 */
export default function HeroBackdropMedia({ bg }: { bg: HeroBackground }) {
  return bg.video ? (
    <Video video={bg.video} width={bg.width} height={bg.height} className="h-full w-full object-cover" autoPlay muted loop controls={false} />
  ) : (
    <Picture src={bg.src} sources={bg.sources} alt="" width={bg.width} height={bg.height} sizes="100vw" className="h-full w-full object-cover" priority />
  );
}
