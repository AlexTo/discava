/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  cuesAtEnd,
  cuesReached,
  cueTime,
  isCorrectAnswer,
  MAX_PLAYBACK_STEP_SECONDS,
  type PlayerCue,
  positionBeforeCue,
  toCues,
  type VideoAnswer,
  type VideoQuestion,
} from './video-questions.js';

const question = (
  questionId: string,
  atSeconds: number | null,
): VideoQuestion => ({
  questionId,
  kind: 'single',
  prompt: '{}',
  options: [{ optionId: 'a', text: 'A' }],
  atSeconds,
  contentHash: `hash-${questionId}`,
});

const cue = (id: string, atSeconds: number | null): PlayerCue => ({
  id,
  atSeconds,
  state: 'unanswered',
  label: id,
});

describe('toCues', () => {
  it('orders by time, then list order, then the end cues', () => {
    const cues = toCues(
      [
        question('end1', null),
        question('b', 30),
        question('a', 10),
        question('b2', 30),
        question('end2', null),
      ],
      {},
    );
    expect(cues.map((c) => c.id)).toEqual(['a', 'b', 'b2', 'end1', 'end2']);
  });

  it('marks answered questions and labels them', () => {
    const answers: Record<string, VideoAnswer> = {
      a: { optionIds: ['a'], correct: true, correctOptionIds: ['a'] },
    };
    const cues = toCues(
      [question('a', 90), question('b', 3725), question('c', null)],
      answers,
    );
    expect(cues.map((c) => [c.state, c.label])).toEqual([
      ['answered', 'Question at 1:30, answered'],
      ['unanswered', 'Question at 1:02:05, not answered'],
      ['unanswered', 'Question at the end, not answered'],
    ]);
  });
});

describe('cueTime', () => {
  it('is the time of a timed cue inside the video', () => {
    expect(cueTime(cue('a', 10), 60)).toBe(10);
    expect(cueTime(cue('a', 0), 60)).toBe(0);
  });

  it('is null for an end cue and for a time at or past the duration', () => {
    expect(cueTime(cue('a', null), 60)).toBeNull();
    expect(cueTime(cue('a', 60), 60)).toBeNull();
    expect(cueTime(cue('a', 90), 60)).toBeNull();
  });
});

describe('cuesReached', () => {
  const cues = [cue('a', 10), cue('b', 10), cue('c', 11), cue('end', null)];

  it('gives the one cue a step straddles', () => {
    expect(cuesReached([cue('a', 10)], 9.8, 10.1, 60).map((c) => c.id)).toEqual(
      ['a'],
    );
  });

  it('gives every cue at the moment, then the next, in order', () => {
    expect(cuesReached(cues, 9.5, 11.2, 60).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('counts a cue at the current time but not at the previous one', () => {
    expect(cuesReached(cues, 9, 10, 60).map((c) => c.id)).toEqual(['a', 'b']);
    expect(cuesReached(cues, 10, 10.5, 60)).toEqual([]);
  });

  it('gives nothing when no cue is passed', () => {
    expect(cuesReached(cues, 1, 2, 60)).toEqual([]);
  });

  it('reaches a cue at 0 on the first step forward from 0', () => {
    expect(cuesReached([cue('z', 0)], 0, 0.25, 60).map((c) => c.id)).toEqual([
      'z',
    ]);
    expect(cuesReached([cue('z', 0)], 0.25, 0.5, 60)).toEqual([]);
  });

  it('gives nothing for a backwards step, no step, or a step over the limit', () => {
    expect(cuesReached(cues, 11, 9, 60)).toEqual([]);
    expect(cuesReached(cues, 10, 10, 60)).toEqual([]);
    expect(
      cuesReached(cues, 5, 5 + MAX_PLAYBACK_STEP_SECONDS + 0.1, 60),
    ).toEqual([]);
    expect(
      cuesReached([cue('a', 6)], 5, 5 + MAX_PLAYBACK_STEP_SECONDS, 60),
    ).toHaveLength(1);
  });

  it('does not report end cues, or timed ones at or past the duration', () => {
    expect(cuesReached([cue('e', null), cue('p', 60)], 59, 60, 60)).toEqual([]);
  });
});

describe('cuesAtEnd', () => {
  it('gives the end cues and the timed ones at or past the duration', () => {
    expect(
      cuesAtEnd(
        [cue('a', 10), cue('b', 60), cue('c', null), cue('d', 99)],
        60,
      ).map((c) => c.id),
    ).toEqual(['b', 'c', 'd']);
  });
});

describe('positionBeforeCue', () => {
  it('is one second before the cue', () => {
    expect(positionBeforeCue(cue('a', 30), 30.2, 60)).toBe(29);
  });

  it('is never below 0', () => {
    expect(positionBeforeCue(cue('a', 0), 0.1, 60)).toBe(0);
    expect(positionBeforeCue(cue('a', 1), 1, 60)).toBe(0);
  });

  it('is one second before the end for an end cue', () => {
    expect(positionBeforeCue(cue('a', null), 60, 60)).toBe(59);
  });
});

describe('isCorrectAnswer', () => {
  it('is true only for exactly the correct options', () => {
    expect(isCorrectAnswer(['a', 'c'], ['c', 'a'])).toBe(true);
    expect(isCorrectAnswer(['a'], ['a', 'c'])).toBe(false);
    expect(isCorrectAnswer(['a', 'b', 'c'], ['a', 'c'])).toBe(false);
    expect(isCorrectAnswer(['b'], ['a'])).toBe(false);
  });
});
