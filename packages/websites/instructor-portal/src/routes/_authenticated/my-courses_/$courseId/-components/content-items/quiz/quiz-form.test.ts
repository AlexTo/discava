/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC,
  fromQuizItem,
  hasErrors,
  newQuestion,
  newQuiz,
  plainText,
  type QuestionState,
  type QuizState,
  toQuizInput,
  validateQuiz,
} from './quiz-form';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const question = (overrides: Partial<QuestionState> = {}): QuestionState => ({
  questionId: 'q1',
  kind: 'single',
  prompt: doc('Which service runs containers?'),
  options: [
    { optionId: 'a', text: 'EC2' },
    { optionId: 'b', text: 'Fargate' },
  ],
  correct: ['b'],
  explanation: '',
  ...overrides,
});

const quiz = (overrides: Partial<QuizState> = {}): QuizState => ({
  ...newQuiz(),
  title: 'Module check',
  questions: [question()],
  ...overrides,
});

describe('validateQuiz', () => {
  it('accepts a complete quiz', () => {
    expect(hasErrors(validateQuiz(quiz()))).toBe(false);
  });

  it.each([
    ['no title', { title: '  ' }, 'Give the quiz a title.'],
    [
      'a pass mark over 100',
      { settings: { ...newQuiz().settings, passMarkPercent: 101 } },
      'The pass mark is a whole number from 0 to 100.',
    ],
    [
      'a pass mark that is not a number',
      { settings: { ...newQuiz().settings, passMarkPercent: Number.NaN } },
      'The pass mark is a whole number from 0 to 100.',
    ],
    [
      'zero attempts',
      { settings: { ...newQuiz().settings, attemptsAllowed: 0 } },
      'Allow at least 1 attempt, or unlimited attempts.',
    ],
    ['no questions', { questions: [] }, 'Add at least one question.'],
  ])('rejects %s', (_, overrides, message) => {
    expect(validateQuiz(quiz(overrides as Partial<QuizState>)).quiz).toContain(
      message,
    );
  });

  it('allows unlimited attempts', () => {
    expect(
      hasErrors(
        validateQuiz(
          quiz({ settings: { ...newQuiz().settings, attemptsAllowed: null } }),
        ),
      ),
    ).toBe(false);
  });

  it.each([
    ['an empty prompt', { prompt: EMPTY_DOC }, 'Write the question.'],
    [
      'fewer than 2 options',
      { options: [{ optionId: 'a', text: 'EC2' }], correct: ['a'] },
      'Give at least 2 options.',
    ],
    [
      'an empty option',
      {
        options: [
          { optionId: 'a', text: 'EC2' },
          { optionId: 'b', text: ' ' },
        ],
      },
      'Fill in every option, or remove the empty ones.',
    ],
    [
      'single choice with no correct option',
      { correct: [] },
      'Mark exactly 1 correct option.',
    ],
    [
      'single choice with 2 correct options',
      { correct: ['a', 'b'] },
      'Mark exactly 1 correct option.',
    ],
    [
      'multiple choice with no correct option',
      { kind: 'multiple' as const, correct: [] },
      'Mark at least 1 correct option.',
    ],
  ])(
    'flags a question with %s, against that question',
    (_, overrides, message) => {
      expect(
        validateQuiz(quiz({ questions: [question(overrides)] })).questions.q1,
      ).toContain(message);
    },
  );

  it('accepts multiple choice with several correct options', () => {
    expect(
      hasErrors(
        validateQuiz(
          quiz({
            questions: [question({ kind: 'multiple', correct: ['a', 'b'] })],
          }),
        ),
      ),
    ).toBe(false);
  });

  it('ignores correct ids for options that were removed', () => {
    expect(
      validateQuiz(quiz({ questions: [question({ correct: ['b', 'gone'] })] }))
        .questions.q1,
    ).toBeUndefined();
  });
});

describe('toQuizInput', () => {
  it('keeps the answer key apart from the questions, in option order, without removed options', () => {
    const input = toQuizInput(
      quiz({
        questions: [
          question({
            kind: 'multiple',
            options: [
              { optionId: 'a', text: ' Lambda ' },
              { optionId: 'b', text: 'EC2' },
              { optionId: 'c', text: 'Fargate' },
            ],
            correct: ['c', 'a', 'gone'],
          }),
        ],
      }),
    );

    expect(input.questions[0].options).toEqual([
      { optionId: 'a', text: 'Lambda' },
      { optionId: 'b', text: 'EC2' },
      { optionId: 'c', text: 'Fargate' },
    ]);
    expect(input.questions[0]).not.toHaveProperty('correct');
    expect(input.answerKey).toEqual({ q1: { correctOptionIds: ['a', 'c'] } });
  });

  it('includes an explanation only when it has text', () => {
    expect(
      toQuizInput(quiz({ questions: [question({ explanation: EMPTY_DOC })] }))
        .answerKey.q1,
    ).toEqual({
      correctOptionIds: ['b'],
    });
    expect(
      toQuizInput(
        quiz({ questions: [question({ explanation: doc('No servers') })] }),
      ).answerKey.q1.explanation,
    ).toBe(doc('No servers'));
  });

  it('trims the title and leaves out an empty description', () => {
    const input = toQuizInput(quiz({ title: '  Check  ', description: '  ' }));
    expect(input.title).toBe('Check');
    expect(input).not.toHaveProperty('description');
  });

  it('round-trips through what the API returns, keeping every id', () => {
    const original = quiz({
      questions: [question({ explanation: doc('Why') })],
    });
    const input = toQuizInput(original);

    const reloaded = fromQuizItem({
      ...input,
      description: undefined,
      quizVersion: 3,
    });

    expect(reloaded.questions).toEqual(original.questions);
    expect(reloaded.settings).toEqual(original.settings);
  });
});

describe('new questions', () => {
  it('start as single choice with two empty options and fresh ids', () => {
    const [a, b] = [newQuestion(), newQuestion()];

    expect(a.kind).toBe('single');
    expect(a.options).toHaveLength(2);
    expect(a.questionId).not.toBe(b.questionId);
    expect(a.options[0].optionId).not.toBe(a.options[1].optionId);
  });
});

describe('plainText', () => {
  it('reads the words of a Tiptap document, and nothing from an empty one', () => {
    expect(plainText(doc('Hello there'))).toBe('Hello there');
    expect(plainText(EMPTY_DOC)).toBe('');
    expect(plainText('not json')).toBe('');
  });
});
