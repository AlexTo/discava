/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The quiz card's view of a quiz and its results. They match core-api's quiz
// outputs (quiz.view, quiz.submitAttempt, quiz.myAttempts) without depending
// on core-api, so instructor-portal's preview can build them too.

export interface QuizOption {
  optionId: string;
  text: string;
}

export interface QuizQuestion {
  questionId: string;
  kind: 'single' | 'multiple';
  // Tiptap JSON, stringified.
  prompt: string;
  options: QuizOption[];
}

export interface QuizSettings {
  passMarkPercent: number;
  // null = unlimited
  attemptsAllowed: number | null;
  shuffleOptions: boolean;
  revealAnswers: 'after_each_attempt' | 'after_final_attempt' | 'never';
}

export interface Quiz {
  title: string;
  description?: string;
  questions: QuizQuestion[];
  settings: QuizSettings;
  questionsHash: string;
}

// { [questionId]: optionId[] }
export type QuizAnswers = Record<string, string[]>;

export interface QuizAttempt {
  answers: QuizAnswers;
  correctQuestionIds: string[];
  scorePercent: number;
  passed: boolean;
  submittedAt: string;
}

export interface QuizSummary {
  attemptsUsed: number;
  attemptsAllowed: number | null;
  bestScore: number;
  passedAt?: string;
}

// The correct options and explanations (Tiptap JSON), per question.
export type QuizReveal = Record<
  string,
  { correctOptionIds: string[]; explanation?: string }
>;

// A question changed by the instructor since the student started answering.
export type QuestionMarker = 'new' | 'updated';

export const attemptsRemain = (
  settings: Pick<QuizSettings, 'attemptsAllowed'>,
  attemptsUsed: number,
) =>
  settings.attemptsAllowed === null || attemptsUsed < settings.attemptsAllowed;

export const isAnswered = (answers: QuizAnswers, questionId: string) =>
  (answers[questionId]?.length ?? 0) > 0;

// A string hashed to a 32-bit seed (FNV-1a).
const seedOf = (value: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

// A small seeded generator (mulberry32): the same seed, the same sequence.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// `options` in an order fixed by `seed`: the same seed always gives the same
// order, so an attempt's shuffled options don't move when the page reloads,
// and the next attempt (a different seed) gets a new order.
export const shuffled = <T>(options: readonly T[], seed: string): T[] => {
  const next = random(seedOf(seed));
  const result = [...options];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const sameQuestion = (a: QuizQuestion, b: QuizQuestion) =>
  a.kind === b.kind &&
  a.prompt === b.prompt &&
  a.options.length === b.options.length &&
  a.options.every(
    (option, i) =>
      option.optionId === b.options[i].optionId &&
      option.text === b.options[i].text,
  );

/**
 * Carries a student's answers over to an edited quiz, comparing questions by
 * `questionId` (see the Quizzes design doc, "Reconciling after CONFLICT"):
 * - unchanged: the answer is kept;
 * - removed: the answer is dropped;
 * - new: unanswered, marked 'new';
 * - changed prompt, options or kind: answers naming options that still exist
 *   are kept (for a question now single choice, only if exactly one is left),
 *   and it's marked 'updated'.
 */
export const reconcile = (
  before: QuizQuestion[],
  after: QuizQuestion[],
  answers: QuizAnswers,
): { answers: QuizAnswers; markers: Record<string, QuestionMarker> } => {
  const previous = new Map(before.map((q) => [q.questionId, q]));
  const nextAnswers: QuizAnswers = {};
  const markers: Record<string, QuestionMarker> = {};

  for (const question of after) {
    const old = previous.get(question.questionId);
    const answer = answers[question.questionId] ?? [];
    if (!old) {
      markers[question.questionId] = 'new';
      continue;
    }
    if (sameQuestion(old, question)) {
      if (answer.length > 0) {
        nextAnswers[question.questionId] = answer;
      }
      continue;
    }
    markers[question.questionId] = 'updated';
    const optionIds = new Set(question.options.map((o) => o.optionId));
    const kept = answer.filter((optionId) => optionIds.has(optionId));
    if (question.kind === 'single' ? kept.length === 1 : kept.length > 0) {
      nextAnswers[question.questionId] = kept;
    }
  }
  return { answers: nextAnswers, markers };
};

/**
 * Grades answers the way core-api's quiz.submitAttempt does, for a preview
 * that never reaches the server: all or nothing per question (exactly the
 * correct options chosen), the score rounded down, and passed when it reaches
 * the pass mark. Keep in step with core-api's gradeAttempt.
 */
export const gradeQuiz = (
  questions: QuizQuestion[],
  reveal: QuizReveal,
  passMarkPercent: number,
  answers: QuizAnswers,
): Pick<QuizAttempt, 'correctQuestionIds' | 'scorePercent' | 'passed'> => {
  const correctQuestionIds = questions
    .filter(({ questionId }) => {
      const selected = answers[questionId] ?? [];
      const correct = new Set(reveal[questionId]?.correctOptionIds ?? []);
      return (
        selected.length === correct.size &&
        selected.every((optionId) => correct.has(optionId))
      );
    })
    .map(({ questionId }) => questionId);
  const scorePercent =
    questions.length === 0
      ? 0
      : Math.floor((correctQuestionIds.length * 100) / questions.length);
  return {
    correctQuestionIds,
    scorePercent,
    passed: scorePercent >= passMarkPercent,
  };
};
