import Link from "next/link";

/** 403 : action d'administration sans session valide. */
export default function Forbidden() {
  return (
    <main className="a-login">
      <div className="a-login-card">
        <h1>Accès refusé</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Cette action est réservée aux administrateurs connectés. Ta session a peut-être expiré.
        </p>
        <p style={{ marginTop: 16 }}>
          <Link href="/admin/connexion" className="a-btn a-btn-primary">
            Se connecter
          </Link>
        </p>
      </div>
    </main>
  );
}
