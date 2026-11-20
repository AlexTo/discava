/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  type NotificationEmailInput,
  renderNotificationEmail,
} from './email-template.js';

const input = (
  overrides: Partial<NotificationEmailInput> = {},
): NotificationEmailInput => ({
  title: 'Assignment graded',
  body: 'Your work was graded.',
  link: { path: '/courses/c1' },
  portalUrl: 'https://student.example.com',
  unsubscribeUrl: 'https://api.example.com/unsubscribe/tok',
  unsubscribePageUrl: 'https://student.example.com/unsubscribe?token=tok',
  settingsUrl: 'https://student.example.com/settings',
  typeName: 'Grade',
  ...overrides,
});

describe('renderNotificationEmail', () => {
  it('adds a second, outline button and a text line for an action', () => {
    const email = renderNotificationEmail(
      input({
        action: {
          label: 'Add to LinkedIn profile',
          path: '/c/x/linkedin?source=issued-email',
        },
      }),
    );
    const url = 'https://student.example.com/c/x/linkedin?source=issued-email';
    expect(email.text).toContain(
      `Open: https://student.example.com/courses/c1\nAdd to LinkedIn profile: ${url}`,
    );
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html).toContain('Add to LinkedIn profile</a>');
    expect(email.html).toContain('border: 1px solid');
  });

  it('escapes an action label in the HTML', () => {
    const email = renderNotificationEmail(
      input({ action: { label: '<b>Go</b>', path: '/x' } }),
    );
    expect(email.html).not.toContain('<b>Go</b>');
    expect(email.html).toContain('&lt;b&gt;Go&lt;/b&gt;');
    expect(email.text).toContain('<b>Go</b>: https://student.example.com/x');
  });

  it('is unchanged without an action', () => {
    const email = renderNotificationEmail(input());
    expect(email.text).toBe(
      renderNotificationEmail(input({ action: undefined })).text,
    );
    expect(email.html).not.toContain('border: 1px solid');
  });

  it('uses the title as the subject and states why the email was sent', () => {
    const email = renderNotificationEmail(input());
    expect(email.subject).toBe('Assignment graded');
    expect(email.text).toContain(
      'You get this because you have Grade emails on. Stop these emails: https://student.example.com/unsubscribe?token=tok',
    );
    expect(email.html).toContain(
      'href="https://student.example.com/unsubscribe?token=tok"',
    );
    // The API route is for the mail client's one-click POST, not for people.
    expect(email.text).not.toContain('https://api.example.com');
    expect(email.html).not.toContain('https://api.example.com');
    expect(email.html).toContain('https://student.example.com/settings');
  });

  it('escapes user-supplied text in the HTML but not the text part', () => {
    const nasty = `<script>alert("x")</script> & 'q'`;
    const email = renderNotificationEmail(
      input({ title: nasty, body: nasty, typeName: nasty }),
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;',
    );
    expect(email.text).toContain(nasty);
  });

  it('cannot add a subject line or header through a title with newlines', () => {
    const email = renderNotificationEmail(
      input({ title: 'Hi\r\nBcc: evil@example.com' }),
    );
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).toBe('Hi Bcc: evil@example.com');
    expect(Object.keys(email.headers).sort()).toEqual([
      'List-Unsubscribe',
      'List-Unsubscribe-Post',
    ]);
  });

  it('sets both one-click unsubscribe headers', () => {
    expect(renderNotificationEmail(input()).headers).toEqual({
      'List-Unsubscribe': '<https://api.example.com/unsubscribe/tok>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('joins the portal URL and path without a double slash', () => {
    const email = renderNotificationEmail(
      input({ portalUrl: 'https://student.example.com/' }),
    );
    expect(email.text).toContain('https://student.example.com/courses/c1');
    expect(email.html).not.toContain('example.com//courses');
  });
});
