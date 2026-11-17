/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEmailInbox,
  renderInboxPage,
  renderMessagePage,
} from './email-inbox.js';

const message = (subject: string) => ({
  to: 'a@example.com',
  from: 'notifications@discava.local',
  subject,
  text: 'text body',
  html: '<p>html body</p>',
  headers: { 'List-Unsubscribe': '<https://x/unsubscribe/t>' },
});

describe('email inbox', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'inbox-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('stores a message and reads it back with its id and time', async () => {
    const inbox = createEmailInbox({
      dir,
      now: () => new Date('2026-11-17T00:00:00.000Z'),
    });
    const { id } = await inbox.store(message('Hello'));
    expect(await inbox.get(id)).toEqual({
      id,
      receivedAt: '2026-11-17T00:00:00.000Z',
      ...message('Hello'),
    });
  });

  it('creates the folder on the first message and lists nothing before it', async () => {
    const inbox = createEmailInbox({ dir: join(dir, 'emails') });
    expect(await inbox.list()).toEqual([]);
    await inbox.store(message('First'));
    expect(await inbox.list()).toHaveLength(1);
  });

  it('lists newest first', async () => {
    let second = 0;
    const inbox = createEmailInbox({
      dir,
      now: () => new Date(Date.UTC(2026, 10, 17, 0, 0, second++)),
    });
    await inbox.store(message('old'));
    await inbox.store(message('new'));
    expect((await inbox.list()).map((m) => m.subject)).toEqual(['new', 'old']);
  });

  it('answers undefined for an unknown id or one that is not an id', async () => {
    const inbox = createEmailInbox({ dir });
    expect(
      await inbox.get('2f1c1f0e-8c7a-4a3e-9d58-3a0a9f8f6b11'),
    ).toBeUndefined();
    expect(await inbox.get('../../etc/passwd')).toBeUndefined();
  });

  it('escapes user text in the inbox pages', () => {
    const evil = {
      id: '2f1c1f0e-8c7a-4a3e-9d58-3a0a9f8f6b11',
      receivedAt: '2026-11-17T00:00:00.000Z',
      ...message('<script>alert(1)</script>'),
      text: '<b>x</b>',
      html: '<p onclick="x">"hi"</p>',
    };
    const list = renderInboxPage([evil]);
    expect(list).not.toContain('<script>');
    expect(list).toContain('&lt;script&gt;');
    const view = renderMessagePage(evil);
    expect(view).not.toContain('<script>');
    expect(view).not.toContain('<b>x</b>');
    expect(view).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(view).toContain(
      'srcdoc="&lt;p onclick=&quot;x&quot;&gt;&quot;hi&quot;&lt;/p&gt;"',
    );
    expect(view).toContain('List-Unsubscribe: &lt;https://x/unsubscribe/t&gt;');
  });
});
