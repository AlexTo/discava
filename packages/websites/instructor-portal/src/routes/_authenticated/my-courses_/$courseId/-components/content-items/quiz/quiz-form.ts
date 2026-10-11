/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The quiz builder's form state and the rules it checks before saving. The
// API checks the same rules (instructor-api `schema/quiz.ts`); checking them
// here as well lets the builder point at the exact question and option.

export type QuestionKind = 'single' | 'multiple';
export type RevealAnswers =
  | 'after_each_attempt'
  | 'after_final_attempt'
  | 'never';

export interface OptionState {
  optionId: string;
  text: string;
}

export interface QuestionState {
  questionId: string;
  kind: QuestionKind;
  // A Tiptap document, as a JSON string.
  prompt: string;
  options: OptionState[];
  // The ids of the correct options.
  correct: string[];
  // A Tiptap document, as a JSON string; empty when there's none.
  explanation: string;
}

export interface SettingsState {
  passMarkPercent: number;
  // null = unlimited
  attemptsAllowed: number | null;
  shuffleOptions: boolean;
  revealAnswers: RevealAnswers;
}

export interface QuizState {
  title: string;
  description: string;
  settings: SettingsState;
  questions: QuestionState[];
}

// The quiz as instructor-api's course.view returns it.
export interface QuizItem {
  title: string;
  description?: string;
  questions: {
    questionId: string;
    kind: QuestionKind;
    prompt: string;
    options: OptionState[];
  }[];
  answerKey: Record<
    string,
    { correctOptionIds: string[]; explanation?: string }
  >;
  settings: SettingsState;
  quizVersion: number;
}

export const MAX_QUESTIONS = 50;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
const MAX_TITLE = 200;
const MAX_OPTION_TEXT = 500;
const MAX_CONTENT_BYTES = 300 * 1024;

export const EMPTY_DOC = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

// Ids are made here, not by the API, so they stay the same across saves: the
// answer key, students' answers and the reconcile after a CONFLICT all refer
// to them.
const newId = () => crypto.randomUUID();

export const newOption = (): OptionState => ({ optionId: newId(), text: '' });

export const newQuestion = (): QuestionState => ({
  questionId: newId(),
  kind: 'single',
  prompt: EMPTY_DOC,
  options: [newOption(), newOption()],
  correct: [],
  explanation: '',
});

export const newQuiz = (): QuizState => ({
  title: '',
  description: '',
  settings: {
    passMarkPercent: 70,
    attemptsAllowed: null,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  questions: [newQuestion()],
});

// The plain text in a Tiptap document, to tell an empty one from one with words.
export const plainText = (doc: string): string => {
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object') {
      return '';
    }
    const { text, content } = node as { text?: string; content?: unknown[] };
    return (text ?? '') + (content ?? []).map(walk).join(' ');
  };
  try {
    return walk(JSON.parse(doc)).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
};

export const fromQuizItem = (item: QuizItem): QuizState => ({
  title: item.title,
  description: item.description ?? '',
  settings: { ...item.settings },
  questions: item.questions.map((question) => ({
    questionId: question.questionId,
    kind: question.kind,
    prompt: question.prompt,
    options: question.options.map((option) => ({ ...option })),
    correct: [...(item.answerKey[question.questionId]?.correctOptionIds ?? [])],
    explanation: item.answerKey[question.questionId]?.explanation ?? '',
  })),
});

// The questions, answer key and settings in the shape createQuiz and
// updateQuiz take. The answer key is kept apart from the questions, so
// students are never sent the answers with the questions.
export const toQuizInput = (quiz: QuizState) => ({
  title: quiz.title.trim(),
  ...(quiz.description.trim() && { description: quiz.description.trim() }),
  settings: quiz.settings,
  questions: quiz.questions.map(({ questionId, kind, prompt, options }) => ({
    questionId,
    kind,
    prompt,
    options: options.map(({ optionId, text }) => ({
      optionId,
      text: text.trim(),
    })),
  })),
  answerKey: Object.fromEntries(
    quiz.questions.map(({ questionId, options, correct, explanation }) => [
      questionId,
      {
        // In option order, and only options that still exist.
        correctOptionIds: options
          .map(({ optionId }) => optionId)
          .filter((optionId) => correct.includes(optionId)),
        ...(plainText(explanation) && { explanation }),
      },
    ]),
  ),
});

export interface QuizErrors {
  // Problems with the quiz as a whole: title, settings, number of questions.
  quiz: string[];
  // Problems with each question, by questionId.
  questions: Record<string, string[]>;
}

export const validateQuiz = (quiz: QuizState): QuizErrors => {
  const errors: QuizErrors = { quiz: [], questions: {} };
  const title = quiz.title.trim();
  if (!title) {
    errors.quiz.push('Give the quiz a title.');
  } else if (title.length > MAX_TITLE) {
    errors.quiz.push(`The title can be at most ${MAX_TITLE} characters.`);
  }
  const { passMarkPercent, attemptsAllowed } = quiz.settings;
  if (
    !Number.isInteger(passMarkPercent) ||
    passMarkPercent < 0 ||
    passMarkPercent > 100
  ) {
    errors.quiz.push('The pass mark is a whole number from 0 to 100.');
  }
  if (
    attemptsAllowed !== null &&
    (!Number.isInteger(attemptsAllowed) || attemptsAllowed < 1)
  ) {
    errors.quiz.push('Allow at least 1 attempt, or unlimited attempts.');
  }
  if (quiz.questions.length === 0) {
    errors.quiz.push('Add at least one question.');
  } else if (quiz.questions.length > MAX_QUESTIONS) {
    errors.quiz.push(`A quiz can have at most ${MAX_QUESTIONS} questions.`);
  }

  for (const question of quiz.questions) {
    const problems: string[] = [];
    if (!plainText(question.prompt)) {
      problems.push('Write the question.');
    }
    if (question.options.length < MIN_OPTIONS) {
      problems.push(`Give at least ${MIN_OPTIONS} options.`);
    } else if (question.options.length > MAX_OPTIONS) {
      problems.push(`Give at most ${MAX_OPTIONS} options.`);
    }
    if (question.options.some(({ text }) => !text.trim())) {
      problems.push('Fill in every option, or remove the empty ones.');
    }
    if (
      question.options.some(({ text }) => text.trim().length > MAX_OPTION_TEXT)
    ) {
      problems.push(`An option can be at most ${MAX_OPTION_TEXT} characters.`);
    }
    const correct = question.options.filter(({ optionId }) =>
      question.correct.includes(optionId),
    ).length;
    if (question.kind === 'single' && correct !== 1) {
      problems.push('Mark exactly 1 correct option.');
    }
    if (question.kind === 'multiple' && correct < 1) {
      problems.push('Mark at least 1 correct option.');
    }
    if (problems.length > 0) {
      errors.questions[question.questionId] = problems;
    }
  }

  if (
    errors.quiz.length === 0 &&
    Object.keys(errors.questions).length === 0 &&
    new TextEncoder().encode(JSON.stringify(toQuizInput(quiz))).length >
      MAX_CONTENT_BYTES
  ) {
    errors.quiz.push('The quiz is too large. Shorten or split some questions.');
  }
  return errors;
};

export const hasErrors = (errors: QuizErrors) =>
  errors.quiz.length > 0 || Object.keys(errors.questions).length > 0;
