/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  ContentItemSchema,
  CreateContentItemQuizInputSchema,
  UpdateContentItemVideoOutputSchema,
  UpdateVideoQuestionsInputSchema,
} from './content-item.js';

const base = {
  contentItemId: 'i1',
  lessonId: 'l1',
  moduleId: 'm1',
  courseId: 'c1',
  status: 'ready',
  title: 'Lecture',
  order: 1,
  visibility: 'visible',
  studentActivityCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const FOLDER = 'courses/c1/modules/m1/lessons/l1/content-items/i1/n1';
const video = {
  ...base,
  type: 'video',
  s3Key: `${FOLDER}/master.m3u8`,
  mimeType: 'video/mp4',
  captionTracks: [
    {
      trackId: 't1',
      nonce: 'n1',
      language: 'en-US',
      label: 'English',
      source: 'auto',
      key: `${FOLDER}/captions/t1.vtt`,
      isDefault: true,
    },
  ],
  captionTracksRev: 3,
  captionsStatus: 'ready',
};

describe('a video content item output', () => {
  it.each([
    ['ContentItemSchema', ContentItemSchema],
    ['UpdateContentItemVideoOutputSchema', UpdateContentItemVideoOutputSchema],
  ])('carries the caption status and track count only (%s)', (_, schema) => {
    const output = schema.parse(video) as Record<string, unknown>;
    expect(output).toMatchObject({
      captionsStatus: 'ready',
      captionTrackCount: 1,
    });
    expect(output).not.toHaveProperty('captionTracks');
    expect(output).not.toHaveProperty('captionTracksRev');
    expect(JSON.stringify(output)).not.toContain('captions/t1.vtt');
  });

  it('leaves the status and count out for a video never captioned', () => {
    const { captionTracks, captionTracksRev, captionsStatus, ...plain } = video;
    const output = ContentItemSchema.parse(plain);
    expect(output).not.toHaveProperty('captionTrackCount');
    expect(output).not.toHaveProperty('captionsStatus');
  });

  it('reports a pending status older than two hours as failed', () => {
    const output = ContentItemSchema.parse({
      ...video,
      captionsStatus: 'pending',
      captionsPendingSince: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    });
    expect(output).toMatchObject({ captionsStatus: 'failed' });
  });

  it('leaves other item types alone', () => {
    const output = ContentItemSchema.parse({
      ...base,
      type: 'text',
      body: '{}',
    });
    expect(output).not.toHaveProperty('captionTrackCount');
    expect(output).not.toHaveProperty('captionsStatus');
  });
});

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const videoQuestion = (n: number, atSeconds: number | null = 1) => ({
  questionId: `q${n}`,
  kind: 'single' as const,
  prompt: doc(`Question ${n}?`),
  options: [
    { optionId: 'a', text: 'Yes' },
    { optionId: 'b', text: 'No' },
  ],
  atSeconds,
});

const keyFor = (questions: { questionId: string }[]) =>
  Object.fromEntries(
    questions.map(({ questionId }) => [
      questionId,
      { correctOptionIds: ['a'] },
    ]),
  );

describe('UpdateVideoQuestionsInputSchema', () => {
  const ref = {
    courseId: 'c1',
    moduleId: 'm1',
    lessonId: 'l1',
    contentItemId: 'i1',
    quizVersion: 0,
  };
  const parse = (
    questions: ReturnType<typeof videoQuestion>[],
    answerKey: Record<string, unknown> = keyFor(questions),
  ) =>
    UpdateVideoQuestionsInputSchema.safeParse({
      ...ref,
      questions,
      answerKey,
    });

  it('accepts an empty list with an empty key', () => {
    expect(parse([], {}).success).toBe(true);
  });

  it('accepts 20 questions and refuses 21', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => videoQuestion(i));
    expect(parse(twenty).success).toBe(true);
    expect(parse([...twenty, videoQuestion(20)]).success).toBe(false);
  });

  it.each([
    [-1, false],
    [1.5, false],
    [86_401, false],
    [0, true],
    [86_400, true],
    [null, true],
  ])('atSeconds of %s is accepted: %s', (atSeconds, accepted) => {
    expect(parse([videoQuestion(1, atSeconds)]).success).toBe(accepted);
  });

  it('refuses a question with no key entry', () => {
    expect(parse([videoQuestion(1)], {}).success).toBe(false);
  });

  it('refuses a key entry for an unknown question', () => {
    expect(
      parse([videoQuestion(1)], {
        ...keyFor([videoQuestion(1)]),
        other: { correctOptionIds: ['a'] },
      }).success,
    ).toBe(false);
  });

  it('refuses two correct options on a single choice question', () => {
    expect(
      parse([videoQuestion(1)], { q1: { correctOptionIds: ['a', 'b'] } })
        .success,
    ).toBe(false);
  });

  it('refuses a correct id that is not an option', () => {
    expect(
      parse([videoQuestion(1)], { q1: { correctOptionIds: ['z'] } }).success,
    ).toBe(false);
  });
});

describe('a video content item with questions', () => {
  it('returns the questions, key and version', () => {
    const questions = [{ ...videoQuestion(1), contentHash: 'h' }];
    const output = ContentItemSchema.parse({
      ...video,
      questions,
      answerKey: keyFor(questions),
      quizVersion: 2,
    });
    expect(output).toMatchObject({
      questions,
      answerKey: keyFor(questions),
      quizVersion: 2,
    });
  });
});

describe('CreateContentItemQuizInputSchema reveal setting', () => {
  const quizInput = (settings: Record<string, unknown>) => ({
    courseId: 'c1',
    moduleId: 'm1',
    lessonId: 'l1',
    title: 'Check',
    questions: [videoQuestion(1, 0)].map(({ atSeconds: _at, ...rest }) => rest),
    answerKey: keyFor([{ questionId: 'q1' }]),
    settings,
  });
  const plain = {
    passMarkPercent: 80,
    attemptsAllowed: 3,
    shuffleOptions: false,
  };

  it('defaults to after_each_attempt when left out', () => {
    const parsed = CreateContentItemQuizInputSchema.parse(quizInput(plain));
    expect(parsed.settings.revealAnswers).toBe('after_each_attempt');
  });

  it('keeps never', () => {
    const parsed = CreateContentItemQuizInputSchema.parse(
      quizInput({ ...plain, revealAnswers: 'never' }),
    );
    expect(parsed.settings.revealAnswers).toBe('never');
  });
});
