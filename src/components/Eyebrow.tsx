import type { CSSProperties } from "react";

export default function Eyebrow({
  children,
  className = "",
  as: Tag = "p",
  style,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "p" | "span" | "div";
  /** Style local du texte (barre typographique de l'éditeur). */
  style?: CSSProperties;
  /** Marqueurs d'édition en place (vue brouillon de l'éditeur seulement). */
  [data: `data-${string}`]: string | number | undefined;
}) {
  return (
    <Tag className={`eyebrow ${className}`} style={style} {...rest}>
      {children}
    </Tag>
  );
}
