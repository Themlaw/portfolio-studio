export default function Eyebrow({
  children,
  className = "",
  as: Tag = "p",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "p" | "span" | "div";
}) {
  return <Tag className={`eyebrow ${className}`}>{children}</Tag>;
}
