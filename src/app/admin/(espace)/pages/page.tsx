import PageHeader from "@/components/admin/PageHeader";
import { listPagesForAdmin } from "@/lib/admin";

export const metadata = { title: "Pages" };

export default function PagesPage() {
  const pages = listPagesForAdmin();
  return (
    <>
      <PageHeader
        title="Pages"
        intro="Organise les pages de ton site : leur place dans le menu, leur adresse en français et en anglais, et les blocs qui les composent."
      />
      {pages.length === 0 ? (
        <div className="a-empty">
          <h2>Ton site n&apos;a pas encore de page</h2>
          <p>Commence par l&apos;accueil : c&apos;est la première page que voient tes visiteurs.</p>
        </div>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Adresse (fr)</th>
                <th scope="col">Adresse (en)</th>
                <th scope="col">Menu</th>
                <th scope="col">Blocs</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/fr/${p.slug.fr}`} target="_blank" rel="noopener">
                      {p.title}
                    </a>
                    {!p.published && <span className="muted"> · brouillon</span>}
                  </td>
                  <td className="mono">/fr/{p.slug.fr}</td>
                  <td className="mono">/en/{p.slug.en}</td>
                  <td>{p.navOrder === null ? <span className="muted">hors menu</span> : `position ${p.navOrder}`}</td>
                  <td className="mono">{p.blocks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
