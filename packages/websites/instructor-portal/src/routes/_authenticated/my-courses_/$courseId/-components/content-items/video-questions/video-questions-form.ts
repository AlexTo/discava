/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The video questions editor's form state and the rules it checks before
// saving. It mirrors the quiz builder's `quiz-form.ts` and reuses its
// question state and per-question checks; the API checks the same rules
// (instructor-api `schema/quiz.ts`).

import {
  newQuestion as newQuizQuestion,
  type OptionState,
  type QuestionKind,
  type QuestionState,
  toQuizInput,
  validateQuestion,
} from '../quiz/quiz-form';

export const MAX_VIDEO_QUESTIONS = 20;
export const MAX_AT_SECONDS = 86_400;

export interface VideoQuestionState extends QuestionState {
  // Whole seconds from the start; null asks it at the end of the video. NaN
  // stands for a time that was typed but isn't one.
  atSeconds: number | null;
}

// The video as instructor-api's course.view returns it.
export interface VideoItem {
  questions?: {
    questionId: string;
    kind: QuestionKind;
    prompt: string;
    options: OptionState[];
    atSeconds: number | null;
  }[];
  answerKey?: Record<
    string,
    { correctOptionIds: string[]; explanation?: string }
  >;
  quizVersion?: number;
}

export const newVideoQuestion = (
  atSeconds: number | null,
): VideoQuestionState => ({ ...newQuizQuestion(), atSeconds });

export const fromVideoItem = (item: VideoItem): VideoQuestionState[] =>
  (item.questions ?? []).map((question) => ({
    questionId: question.questionId,
    kind: question.kind,
    prompt: question.prompt,
    options: question.options.map((option) => ({ ...option })),
    correct: [
      ...(item.answerKey?.[question.questionId]?.correctOptionIds ?? []),
    ],
    explanation: item.answerKey?.[question.questionId]?.explanation ?? '',
    atSeconds: question.atSeconds,
  }));

// What contentItem.updateVideoQuestions takes, minus the item's keys.
export const toVideoQuestionsInput = (
  questions: VideoQuestionState[],
  quizVersion: number,
) => {
  const input = toQuizInput({
    title: '',
    description: '',
    settings: {
      passMarkPercent: 0,
      attemptsAllowed: null,
      shuffleOptions: false,
      revealAnswers: 'never',
    },
    questions,
  });
  return {
    quizVersion,
    questions: input.questions.map((question) => ({
      ...question,
      atSeconds:
        questions.find(({ questionId }) => questionId === question.questionId)
          ?.atSeconds ?? null,
    })),
    answerKey: input.answerKey,
  };
};

// 'm:ss', or 'h:mm:ss' from an hour.
export const formatTime = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

// '1:30' → 90 and '1:02:03' → 3723; undefined for anything else.
export const parseTime = (text: string): number | undefined => {
  const match = /^(?:(\d+):([0-5]\d)|(\d+):([0-5]\d):([0-5]\d))$/.exec(
    text.trim(),
  );
  if (!match) {
    return undefined;
  }
  return match[1] !== undefined
    ? Number(match[1]) * 60 + Number(match[2])
    : Number(match[3]) * 3600 + Number(match[4]) * 60 + Number(match[5]);
};

const rank = (question: VideoQuestionState) =>
  question.atSeconds === null || Number.isNaN(question.atSeconds)
    ? Number.POSITIVE_INFINITY
    : question.atSeconds;

// Asking order: by time, keeping the given order for equal moments, then the
// end questions in the given order.
export const sortQuestions = (
  questions: VideoQuestionState[],
): VideoQuestionState[] =>
  questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => {
      const ra = rank(a.question);
      const rb = rank(b.question);
      return ra === rb ? a.index - b.index : ra < rb ? -1 : 1;
    })
    .map(({ question }) => question);

// Swaps a question with its neighbour when both are asked at the same moment
// (or both at the end); otherwise nothing moves.
export const moveWithinMoment = (
  questions: VideoQuestionState[],
  questionId: string,
  direction: 'up' | 'down',
): VideoQuestionState[] => {
  const from = questions.findIndex((q) => q.questionId === questionId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= questions.length) {
    return questions;
  }
  if (questions[from].atSeconds !== questions[to].atSeconds) {
    return questions;
  }
  const next = questions.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};

export const canMove = (
  questions: VideoQuestionState[],
  questionId: string,
  direction: 'up' | 'down',
) => moveWithinMoment(questions, questionId, direction) !== questions;

// A question timed at or past the end of the video is asked with the end
// check.
export const isAfterEnd = (
  question: VideoQuestionState,
  durationSeconds: number,
) => question.atSeconds !== null && question.atSeconds >= durationSeconds;

export interface VideoQuestionErrors {
  // Problems with the list as a whole.
  video: string[];
  // Problems with each question, by questionId.
  questions: Record<string, string[]>;
}

export const validateVideoQuestions = (
  questions: VideoQuestionState[],
): VideoQuestionErrors => {
  const errors: VideoQuestionErrors = { video: [], questions: {} };
  if (questions.length > MAX_VIDEO_QUESTIONS) {
    errors.video.push(
      `A video can have at most ${MAX_VIDEO_QUESTIONS} questions.`,
    );
  }
  for (const question of questions) {
    const problems = validateQuestion(question);
    const { atSeconds } = question;
    if (
      atSeconds !== null &&
      (!Number.isInteger(atSeconds) ||
        atSeconds < 0 ||
        atSeconds > MAX_AT_SECONDS)
    ) {
      problems.unshift('Ask it at a time like 1:30, or at the end.');
    }
    if (problems.length > 0) {
      errors.questions[question.questionId] = problems;
    }
  }
  return errors;
};

export const hasErrors = (errors: VideoQuestionErrors) =>
  errors.video.length > 0 || Object.keys(errors.questions).length > 0;
