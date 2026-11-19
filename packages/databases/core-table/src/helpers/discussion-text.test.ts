/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { uuidV7At } from '../test-support/uuid-v7.js';
import {
  answeredState,
  checkPostId,
  DISCUSSION_BODY_MAX,
  DISCUSSION_TITLE_MAX,
  normaliseDiscussionText,
  postIdTime,
} from './discussion-text.js';

const NOW = new Date('2026-11-16T10:00:00.000Z');

const v7 = (at: Date) => uuidV7At(at);
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('normaliseDiscussionText', () => {
  const body = { min: 1, max: DISCUSSION_BODY_MAX };

  it('trims the text', () => {
    expect(normaliseDiscussionText('  hello \n', body)).toEqual({
      text: 'hello',
    });
  });

  it.each(['', '   ', '\n\t '])('refuses %j as empty', (text) => {
    expect(normaliseDiscussionText(text, body)).toEqual({ reason: 'empty' });
  });

  it('accepts 4,000 characters and refuses 4,001', () => {
    expect(normaliseDiscussionText('a'.repeat(4000), body).text).toHaveLength(
      4000,
    );
    expect(normaliseDiscussionText('a'.repeat(4001), body)).toEqual({
      reason: 'too-long',
    });
  });

  it('counts the trimmed text, not the padding', () => {
    expect(
      normaliseDiscussionText(` ${'a'.repeat(4000)} `, body).text,
    ).toHaveLength(4000);
  });

  it('counts an emoji and an accented letter as written, one each', () => {
    const emoji = '😀'.repeat(4000);
    expect(normaliseDiscussionText(emoji, body).text).toBe(emoji);
    expect(normaliseDiscussionText(`${emoji}😀`, body)).toEqual({
      reason: 'too-long',
    });
    const accents = 'é'.repeat(DISCUSSION_TITLE_MAX);
    expect(
      normaliseDiscussionText(accents, { min: 1, max: DISCUSSION_TITLE_MAX })
        .text,
    ).toBe(accents);
  });
});

describe('postIdTime', () => {
  it('reads the milliseconds of a UUID v7', () => {
    expect(postIdTime(v7(NOW))).toBe(NOW.getTime());
  });

  it.each([
    ['a UUID v4', '3b241101-e2bb-4255-8caf-4136c566a962'],
    ['a malformed string', 'not-an-id'],
    ['an empty string', ''],
  ])('is undefined for %s', (_, id) => {
    expect(postIdTime(id)).toBeUndefined();
  });
});

describe('checkPostId', () => {
  it('accepts an id from 9 minutes ago, and gives its time', () => {
    expect(checkPostId(v7(minutes(-9)), NOW)).toEqual({
      time: minutes(-9).toISOString(),
    });
  });

  it('accepts an id from 9 minutes ahead', () => {
    expect(checkPostId(v7(minutes(9)), NOW).reason).toBeUndefined();
  });

  it.each([
    ['a v4 UUID', '3b241101-e2bb-4255-8caf-4136c566a962', 'not-uuid-v7'],
    ['a malformed string', 'nope', 'not-uuid-v7'],
    ['an id 11 minutes in the past', v7(minutes(-11)), 'outside-window'],
    ['an id 11 minutes in the future', v7(minutes(11)), 'outside-window'],
  ])('refuses %s', (_, id, reason) => {
    expect(checkPostId(id, NOW)).toEqual({ reason });
  });
});

describe('answeredState', () => {
  it.each([
    ['shown', undefined, 0, 'unanswered'],
    ['shown', undefined, undefined, 'unanswered'],
    ['shown', 'r1', 0, 'answered'],
    ['shown', undefined, 1, 'answered'],
    ['shown', 'r1', 2, 'answered'],
    ['hidden', undefined, 0, 'not-open'],
    ['hidden', 'r1', 1, 'not-open'],
    ['deleted', undefined, 0, 'not-open'],
    ['deleted', 'r1', 1, 'not-open'],
  ] as const)(
    'a %s question, accepted %s, %s instructor replies: %s',
    (state, acceptedPostId, instructorReplyCount, expected) => {
      expect(
        answeredState({ state, acceptedPostId, instructorReplyCount }),
      ).toBe(expected);
    },
  );
});
