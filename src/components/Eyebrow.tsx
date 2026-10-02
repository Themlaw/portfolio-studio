export default function Eyebrow({
  children,
  className = "",
  as: Tag = "p",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "p" | "span" | "div";
  /** Marqueurs d'édition en place (vue brouillon de l'éditeur seulement). */
  [data: `data-${string}`]: string | number | undefined;
}) {
  return (
    <Tag className={`eyebrow ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
