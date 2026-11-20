/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface NotificationEmailInput {
  title: string;
  body: string;
  /** Where the notification leads; `path` starts with `/`. */
  link: { path: string };
  /** A second link, in the same portal as `link`; `path` starts with `/`. */
  action?: { label: string; path: string };
  /** The URL of the portal `link` belongs to. */
  portalUrl: string;
  /** The API route: for the one-click `List-Unsubscribe` header only. */
  unsubscribeUrl: string;
  /** The student portal's unsubscribe page: what the person opens from the body. */
  unsubscribePageUrl: string;
  settingsUrl: string;
  /** The notification type's display name, as in the settings page. */
  typeName: string;
}

export interface NotificationEmail {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// A line break in the subject or a header value would let a title add headers.
const singleLine = (value: string): string =>
  value.replace(/[\r\n]+/g, ' ').trim();

const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

/**
 * Builds the subject, both bodies and the one-click unsubscribe headers. The
 * body's links open the portal's page (a `GET` on the API shows raw JSON);
 * mail clients POST to the header's API URL.
 */
export const renderNotificationEmail = ({
  title,
  body,
  link,
  action,
  portalUrl,
  unsubscribeUrl,
  unsubscribePageUrl,
  settingsUrl,
  typeName,
}: NotificationEmailInput): NotificationEmail => {
  const subject = singleLine(title);
  const url = joinUrl(portalUrl, link.path);
  const actionUrl = action && joinUrl(portalUrl, action.path);
  const reason = `You get this because you have ${typeName} emails on.`;

  const text = [
    title,
    '',
    body,
    '',
    `Open: ${url}`,
    ...(action ? [`${singleLine(action.label)}: ${actionUrl}`] : []),
    '',
    `${reason} Stop these emails: ${unsubscribePageUrl}`,
    `Email settings: ${settingsUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html>
<body style="font-family: sans-serif; color: #1f2937;">
<h1 style="font-size: 20px;">${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p><a href="${escapeHtml(url)}" style="display: inline-block; padding: 10px 16px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px;">Open</a></p>
${action ? `<p><a href="${escapeHtml(actionUrl ?? '')}" style="display: inline-block; padding: 9px 15px; border: 1px solid #2563eb; color: #2563eb; text-decoration: none; border-radius: 4px;">${escapeHtml(action.label)}</a></p>\n` : ''}<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<hr>
<p style="font-size: 12px; color: #6b7280;">You get this because you have ${escapeHtml(typeName)} emails on. <a href="${escapeHtml(unsubscribePageUrl)}">Stop these emails</a>. <a href="${escapeHtml(settingsUrl)}">Email settings</a>.</p>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${singleLine(unsubscribeUrl)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
};
