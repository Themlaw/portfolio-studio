export default function Eyebrow({
  children,
  className = "",
  as: Tag = "p",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "p" | "span" | "div";
  /** Marqueur d'édition en place (vue brouillon de l'éditeur seulement). */
  "data-inline"?: string;
}) {
  return (
    <Tag className={`eyebrow ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
