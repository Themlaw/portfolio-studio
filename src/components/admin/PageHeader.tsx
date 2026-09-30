/** En-tête d'un écran de l'admin : titre, phrase d'intention, action principale. */
export default function PageHeader({
  title,
  intro,
  action,
}: {
  title: string;
  intro?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="a-page-header">
      <div>
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
      {action}
    </header>
  );
}
