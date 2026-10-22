import { DeleteAllMessages, DeleteMessage } from "@/components/admin/MessageActions";
import PageHeader from "@/components/admin/PageHeader";
import MarkMessagesSeen from "@/components/admin/MarkMessagesSeen";
import { countMessages, lastSeenMessageId, listMessages, messagesEmailConfigured, MESSAGES_CAP } from "@/lib/admin";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

/**
 * Messages reçus par les formulaires de contact des pages. Aucun serveur
 * d'envoi d'e-mail n'est configuré : c'est ici qu'ils arrivent (lecture seule).
 */
export default function MessagesPage() {
  const messages = listMessages();
  // Repère « Nouveau » : lu AVANT que la visite ne marque les messages comme vus (MarkMessagesSeen).
  const seen = lastSeenMessageId();
  const newCount = messages.filter((m) => m.id > seen).length;
  const total = countMessages();
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
  return (
    <>
      <PageHeader
        title="Messages"
        intro="Ce que les visiteurs t'écrivent depuis un formulaire de contact."
      />
      <MarkMessagesSeen upTo={Math.max(0, ...messages.map((m) => m.id))} />
      {!messagesEmailConfigured() && (
        <p className="a-notice" role="status" data-testid="messages-no-email">
          Les messages arrivent ici. Pense à passer voir.
        </p>
      )}
      {newCount > 0 && (
        <p className="a-new-count" data-testid="messages-new-count">
          {newCount} nouveau{newCount > 1 ? "x" : ""} message{newCount > 1 ? "s" : ""}
        </p>
      )}
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
            <li key={m.id} className="a-card a-message" data-new={m.id > seen ? "" : undefined}>
              <header className="a-message-head">
                <strong>
                  {m.subject}
                  {m.id > seen && <span className="a-badge a-new-badge">Nouveau</span>}
                </strong>
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
