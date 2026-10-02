import { DeleteAllMessages, DeleteMessage } from "@/components/admin/MessageActions";
import PageHeader from "@/components/admin/PageHeader";
import { countMessages, listMessages, MESSAGES_CAP } from "@/lib/admin";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

/**
 * Messages reçus par les formulaires de contact des pages. Aucun serveur
 * d'envoi d'e-mail n'est configuré : c'est ici qu'ils arrivent (lecture seule).
 */
export default function MessagesPage() {
  const messages = listMessages();
  const total = countMessages();
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
  return (
    <>
      <PageHeader
        title="Messages"
        intro="Ce que les visiteurs t'écrivent depuis un formulaire de contact. Envoi par e-mail : non configuré (aucun serveur d'envoi) — les messages arrivent ici."
      />
      {total >= MESSAGES_CAP && (
        <p className="a-field-error" role="alert" data-testid="messages-full">
          Boîte pleine ({total} messages) : les nouveaux envois sont refusés. Supprime des messages pour en recevoir à nouveau.
        </p>
      )}
      {total > 0 && (
        <p className="muted">
          {total} message{total > 1 ? "s" : ""} (gardés un an, {MESSAGES_CAP} au plus). <DeleteAllMessages count={total} />
        </p>
      )}
      {messages.length === 0 ? (
        <p className="muted">Aucun message pour l&apos;instant. Ajoute un « Formulaire de contact » à une page depuis l&apos;éditeur.</p>
      ) : (
        <ul className="a-messages" data-testid="messages">
          {messages.map((m) => (
            <li key={m.id} className="a-card a-message">
              <header className="a-message-head">
                <strong>{m.subject}</strong>
                <span className="muted">
                  {date.format(m.createdAt)}
                  {m.page ? ` · page « ${m.page} »` : ""}
                </span>
              </header>
              <dl className="a-message-fields">
                {m.fields.map((f, i) => (
                  <div key={i}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
              <DeleteMessage id={m.id} />
              {m.replyTo && (
                <a className="a-btn a-btn-small" href={`mailto:${encodeURIComponent(m.replyTo).replace("%40", "@")}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}>
                  Répondre à {m.replyTo}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
