import Diagnostic from "@/components/admin/Diagnostic";
import PageHeader from "@/components/admin/PageHeader";
import { getSettingsForAdmin } from "@/lib/admin";

export const metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const s = getSettingsForAdmin();
  return (
    <>
      <PageHeader
        title="Réglages"
        intro="L'identité de ton site : ton nom, ton métier, l'adresse où l'on peut t'écrire et tes réseaux."
      />
      <div className="a-table-wrap">
        <dl className="a-dl">
          <dt>Nom affiché</dt>
          <dd>{s.name || <span className="muted">non renseigné</span>}</dd>
          <dt>Métier</dt>
          <dd>{s.role || <span className="muted">non renseigné</span>}</dd>
          <dt>Adresse de contact</dt>
          <dd className="mono">{s.email || <span className="muted">non renseignée</span>}</dd>
          <dt>Réseaux</dt>
          <dd>
            {s.socials.length === 0 ? (
              <span className="muted">aucun réseau</span>
            ) : (
              s.socials.map((x) => (
                <span key={x.label} style={{ display: "block" }}>
                  {x.label} <span className="mono muted">{x.href}</span>
                </span>
              ))
            )}
          </dd>
        </dl>
      </div>
      <div className="a-empty a-section">
        <h2>Modifier ces informations</h2>
        <p>
          Elles apparaissent en haut et en bas de chaque page, et sur la page À propos : une modification sera visible
          partout à la fois.
        </p>
      </div>
      <Diagnostic />
    </>
  );
}
