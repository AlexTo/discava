/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface NotificationEmailInput {
  title: string;
  body: string;
  /** Where the notification leads; `path` starts with `/`. */
  link: { path: string };
  /** The URL of the portal `link` belongs to. */
  portalUrl: string;
  unsubscribeUrl: string;
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

/** Builds the subject, both bodies and the one-click unsubscribe headers. */
export const renderNotificationEmail = ({
  title,
  body,
  link,
  portalUrl,
  unsubscribeUrl,
  settingsUrl,
  typeName,
}: NotificationEmailInput): NotificationEmail => {
  const subject = singleLine(title);
  const url = joinUrl(portalUrl, link.path);
  const reason = `You get this because you have ${typeName} emails on.`;

  const text = [
    title,
    '',
    body,
    '',
    `Open: ${url}`,
    '',
    `${reason} Stop these emails: ${unsubscribeUrl}`,
    `Email settings: ${settingsUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html>
<body style="font-family: sans-serif; color: #1f2937;">
<h1 style="font-size: 20px;">${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p><a href="${escapeHtml(url)}" style="display: inline-block; padding: 10px 16px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px;">Open</a></p>
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<hr>
<p style="font-size: 12px; color: #6b7280;">You get this because you have ${escapeHtml(typeName)} emails on. <a href="${escapeHtml(unsubscribeUrl)}">Stop these emails</a>. <a href="${escapeHtml(settingsUrl)}">Email settings</a>.</p>
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
