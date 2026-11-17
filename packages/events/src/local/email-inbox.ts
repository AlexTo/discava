/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalEmailRequest } from '@discava/common-server-utils/local-dev';

export interface StoredEmail extends LocalEmailRequest {
  id: string;
  receivedAt: string;
}

const ID = /^[0-9a-f-]{36}$/;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const page = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;max-width:60rem;margin:2rem auto">${body}</body></html>`;

/**
 * Local dev's stand-in for SES: sent emails are kept as JSON files in `dir`
 * (git-ignored `tmp/local-dev/emails/`, deleted by reset-local-data), so they
 * outlive a restart of the runner.
 */
export const createEmailInbox = ({
  dir,
  now = () => new Date(),
  newId = randomUUID,
}: {
  dir: string;
  now?: () => Date;
  newId?: () => string;
}) => {
  const read = async (id: string): Promise<StoredEmail | undefined> => {
    if (!ID.test(id)) {
      return undefined;
    }
    try {
      return JSON.parse(
        await readFile(join(dir, `${id}.json`), 'utf8'),
      ) as StoredEmail;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  };

  return {
    /** Stores a message and returns its generated id. */
    store: async (message: LocalEmailRequest): Promise<{ id: string }> => {
      const id = newId();
      const stored: StoredEmail = {
        id,
        receivedAt: now().toISOString(),
        to: message.to,
        from: message.from,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      };
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.json`), JSON.stringify(stored, null, 2));
      return { id };
    },
    /** Every stored message, newest first. */
    list: async (): Promise<StoredEmail[]> => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
      const messages = await Promise.all(
        names
          .filter((name) => name.endsWith('.json'))
          .map((name) => read(name.slice(0, -'.json'.length))),
      );
      return messages
        .filter((message): message is StoredEmail => message !== undefined)
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    },
    get: read,
  };
};

export type EmailInbox = ReturnType<typeof createEmailInbox>;

/** The inbox's list page: one row per message, newest first. */
export const renderInboxPage = (messages: StoredEmail[]): string =>
  page(
    'Local inbox',
    `<h1>Local inbox</h1>${
      messages.length === 0
        ? '<p>No emails yet.</p>'
        : `<ul>${messages
            .map(
              (m) =>
                `<li><a href="/inbox/${m.id}">${escapeHtml(m.subject)}</a> to ${escapeHtml(m.to)} at ${escapeHtml(m.receivedAt)}</li>`,
            )
            .join('')}</ul>`
    }`,
  );

/** One message: headers, the text part and a sandboxed preview of the HTML. */
export const renderMessagePage = (message: StoredEmail): string =>
  page(
    message.subject,
    `<p><a href="/inbox">Inbox</a></p>
<h1>${escapeHtml(message.subject)}</h1>
<p>From ${escapeHtml(message.from)} to ${escapeHtml(message.to)} at ${escapeHtml(message.receivedAt)}</p>
<h2>Headers</h2>
<pre>${escapeHtml(
      Object.entries(message.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n'),
    )}</pre>
<h2>Text</h2>
<pre style="white-space:pre-wrap">${escapeHtml(message.text)}</pre>
<h2>HTML</h2>
<iframe sandbox style="width:100%;height:30rem;border:1px solid #ccc" srcdoc="${escapeHtml(message.html)}"></iframe>`,
  );
