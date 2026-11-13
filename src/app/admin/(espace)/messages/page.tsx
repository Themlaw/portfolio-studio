import { getAdminLang, getAdminT } from "@/i18n/admin-server";
import { intlLocale } from "@/i18n/admin-lang";
import { DeleteAllMessages, DeleteMessage } from "@/components/admin/MessageActions";
import PageHeader from "@/components/admin/PageHeader";
import MarkMessagesSeen from "@/components/admin/MarkMessagesSeen";
import { countMessages, lastSeenMessageId, listMessages, messagesEmailConfigured, MESSAGES_CAP } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/guard";

export async function generateMetadata() {
  return { title: (await getAdminT("messages"))("title") };
}
export const dynamic = "force-dynamic";

/**
 * Messages reçus par les formulaires de contact des pages. Aucun serveur
 * d'envoi d'e-mail n'est configuré : c'est ici qu'ils arrivent (lecture seule).
 */
export default async function MessagesPage() {
  await requireAdmin();
  const t = await getAdminT("messages");
  const lang = await getAdminLang();
  const messages = listMessages();
  // Repère « Nouveau » : lu AVANT que la visite ne marque les messages comme vus (MarkMessagesSeen).
  const seen = lastSeenMessageId();
  const newCount = messages.filter((m) => m.id > seen).length;
  const total = countMessages();
  const date = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short" });
  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
      />
      <MarkMessagesSeen upTo={Math.max(0, ...messages.map((m) => m.id))} />
      {!messagesEmailConfigured() && (
        <p className="a-notice" role="status" data-testid="messages-no-email">
          {t("noEmail")}
        </p>
      )}
      {newCount > 0 && (
        <p className="a-new-count" data-testid="messages-new-count">
          {t("newCount", { count: newCount })}
        </p>
      )}
      {total >= MESSAGES_CAP && (
        <p className="a-field-error" role="alert" data-testid="messages-full">
          {t("full", { total })}
        </p>
      )}
      {total > 0 && (
        <p className="muted">
          {t("summary", { total, cap: MESSAGES_CAP })} <DeleteAllMessages count={total} />
        </p>
      )}
      {messages.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="a-messages" data-testid="messages">
          {messages.map((m) => (
            <li key={m.id} className="a-card a-message" data-new={m.id > seen ? "" : undefined}>
              <header className="a-message-head">
                <strong>
                  {m.subject}
                  {m.id > seen && <span className="a-badge a-new-badge">{t("badgeNew")}</span>}
                </strong>
                <span className="muted">
                  {date.format(m.createdAt)}
                  {m.page ? t("onPage", { page: m.page }) : ""}
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
                  {t("replyTo", { email: m.replyTo })}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
