import PageHeader from "@/components/admin/PageHeader";
import { listProjectsForAdmin } from "@/lib/admin";

export const metadata = { title: "Projets" };

const COLLECTIONS: Record<string, string> = {
  characters: "Personnages",
  backgrounds: "Décors",
  animation: "Animation",
};

export default function ProjectsPage() {
  const projects = listProjectsForAdmin();
  return (
    <>
      <PageHeader
        title="Projets"
        intro="Rassemble tes images par projet : l'ordre des planches, les légendes, et les emplacements gardés pour une image à venir."
      />
      {projects.length === 0 ? (
        <div className="a-empty">
          <h2>Aucun projet pour l&apos;instant</h2>
          <p>
            Un projet regroupe les images d&apos;une même commande ou d&apos;une même recherche : c&apos;est ainsi que tes
            visiteurs les découvrent.
          </p>
        </div>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th scope="col">Projet</th>
                <th scope="col">Période</th>
                <th scope="col">Images</th>
                <th scope="col">Métiers</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td className="mono">{p.year}</td>
                  <td className="mono">
                    {p.slots - p.empty}
                    {p.empty > 0 && <span className="muted"> + {p.empty} à compléter</span>}
                  </td>
                  <td>{p.collections.map((c) => COLLECTIONS[c] ?? c).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
