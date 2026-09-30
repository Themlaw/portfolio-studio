import PageHeader from "@/components/admin/PageHeader";
import { listMediaForAdmin } from "@/lib/admin";

export const metadata = { title: "Médiathèque" };

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export default function MediaPage() {
  const media = listMediaForAdmin();
  return (
    <>
      <PageHeader
        title="Médiathèque"
        intro="Toutes tes images et vidéos au même endroit : leurs textes de description, leurs formats, et les pages où chacune apparaît."
      />
      {media.length === 0 ? (
        <div className="a-empty">
          <h2>Ta médiathèque est vide</h2>
          <p>Les images que tu déposeras dans tes projets arriveront ici, prêtes à être réutilisées ailleurs sur le site.</p>
        </div>
      ) : (
        <div className="a-media-grid">
          {media.map((m) => (
            <figure key={m.id} className="a-media" style={{ margin: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" loading="lazy" />
              <figcaption>
                <span title={m.name}>{m.name}</span>
                <span className="mono muted">
                  {m.width && m.height ? `${m.width}×${m.height} · ` : ""}
                  {size(m.size)}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
