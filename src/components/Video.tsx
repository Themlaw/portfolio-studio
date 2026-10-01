import type { VideoView } from "@/lib/media";

/**
 * Vidéo hébergée : <video> avec poster, préchargement des seules
 * métadonnées, lecture en ligne (mobile), contrôles. Deux <source> choisies
 * par `media` : 1080 sur un grand écran, 720 sinon (et en repli).
 * width/height réservent la place avant le chargement.
 */
export default function Video({
  video,
  width,
  height,
  className,
  autoPlay = false,
  muted = false,
  loop = false,
  controls = true,
  label,
}: {
  video: VideoView;
  width: number;
  height: number;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  label?: string;
}) {
  const hd = video.sources.mp4.find((s) => Math.min(s.w, s.h) >= 1080);
  const sd = video.sources.mp4.find((s) => s !== hd) ?? video.sources.mp4[0];
  return (
    <video
      poster={video.sources.poster.largest.webp}
      preload="metadata"
      playsInline
      controls={controls}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      width={width}
      height={height}
      className={className}
      aria-label={label}
      style={video.sources.poster.color ? { backgroundColor: video.sources.poster.color } : undefined}
    >
      {hd && <source src={hd.src} type="video/mp4" media="(min-width: 1280px)" />}
      <source src={sd.src} type="video/mp4" />
    </video>
  );
}
