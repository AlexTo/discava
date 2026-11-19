/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  attemptsRemain,
  type QuestionMarker,
  type Quiz,
  type QuizAnswers,
  type QuizAttempt,
  type QuizDraft,
  type QuizQuestion,
  type QuizReveal,
  type QuizSummary,
  readQuizDraft,
  reconcile,
  shuffled,
  writeQuizDraft,
} from '@discava/common-web-utils/quiz';
import { useEffect, useMemo, useState } from 'react';
import {
  OverviewPhase,
  type Phase,
  QuestionPhase,
  ResultPhase,
  ReviewPhase,
} from './quiz-card-phases';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Card, CardContent } from './ui/card';

/** What submitting an attempt came to, as the card's owner reports it. */
export type QuizSubmitResult =
  | {
      status: 'submitted';
      attempt: QuizAttempt;
      summary: QuizSummary;
      reveal: QuizReveal | null;
    }
  // The questions changed since the student started (core-api's CONFLICT).
  // Nothing was recorded; the owner refetches the quiz, and the card
  // carries the answers over once the new questions arrive.
  | { status: 'updated' }
  // Refused. `closed` when the quiz can't be taken any more (removed, its
  // course archived, no attempts left): the card drops the student's draft.
  | { status: 'error'; message: string; closed?: boolean };

export interface QuizCardProps {
  quiz: Quiz;
  /** The student's summary, or null before their first attempt. */
  summary: QuizSummary | null;
  /** Their latest attempt, shown as the result until they retake. */
  lastAttempt: QuizAttempt | null;
  /** Correct options and explanations, once the quiz's settings allow. */
  reveal: QuizReveal | null;
  /**
   * Identifies the quiz for the student: seeds the shuffled option order
   * (with the attempt number) and names the saved draft.
   */
  quizKey: string;
  onSubmit: (
    answers: QuizAnswers,
    questionsHash: string,
  ) => Promise<QuizSubmitResult>;
  /** Called when the review screen opens, e.g. to refetch the quiz. */
  onReview?: () => void;
  /** Why the quiz can't be taken now (e.g. an archived course), if so. */
  closedReason?: string;
  /** Save answers in progress in localStorage. @default true */
  saveDrafts?: boolean;
}

/**
 * A quiz as a card in a lesson: an overview, then one question per screen
 * with a dot navigator, a review step, and the result. Grading happens in
 * `onSubmit` (core-api for students; locally in the instructor's preview),
 * and feedback only ever comes after submitting.
 *
 * If the questions change while the student is answering (a new `quiz` with
 * a different `questionsHash`, or `onSubmit` reporting `updated`), their
 * answers are carried over (see reconcile in @discava/common-web-utils/quiz),
 * changed questions are marked New or Updated, and the review screen says so.
 */
export function QuizCard({
  quiz,
  summary: initialSummary,
  lastAttempt,
  reveal: initialReveal,
  quizKey,
  onSubmit,
  onReview,
  closedReason,
  saveDrafts = true,
}: QuizCardProps) {
  const [phase, setPhase] = useState<Phase>({ name: 'overview' });
  const [draft, setDraft] = useState<QuizDraft | null>(() =>
    saveDrafts ? readQuizDraft(quizKey) : null,
  );
  const [markers, setMarkers] = useState<Record<string, QuestionMarker>>({});
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  // The latest submission's result, until the owner's props catch up.
  const [submitted, setSubmitted] =
    useState<Extract<QuizSubmitResult, { status: 'submitted' }>>();

  const summary = submitted?.summary ?? initialSummary;
  const attempt = submitted?.attempt ?? lastAttempt;
  const reveal = submitted ? submitted.reveal : initialReveal;
  const { settings } = quiz;
  const canAttempt =
    !closedReason && attemptsRemain(settings, summary?.attemptsUsed ?? 0);
  const inProgress = phase.name === 'question' || phase.name === 'review';

  const saveDraft = (next: QuizDraft | null) => {
    setDraft(next);
    if (saveDrafts) {
      writeQuizDraft(quizKey, next);
    }
  };

  // New questions while answering: carry the answers over and send the
  // student to review what changed.
  useEffect(() => {
    if (!draft || !inProgress || draft.questionsHash === quiz.questionsHash) {
      return;
    }
    const next = reconcile(draft.questions, quiz.questions, draft.answers);
    saveDraft({
      ...draft,
      questions: quiz.questions,
      questionsHash: quiz.questionsHash,
      answers: next.answers,
    });
    setMarkers((current) => ({ ...current, ...next.markers }));
    setUpdated(true);
    setPhase({ name: 'review' });
  });

  // Each question's options, in this attempt's order.
  const optionsFor = useMemo(() => {
    const attemptNumber = draft?.attemptNumber ?? 1;
    return (question: QuizQuestion) =>
      settings.shuffleOptions
        ? shuffled(
            question.options,
            `${quizKey}:${attemptNumber}:${question.questionId}`,
          )
        : question.options;
  }, [draft?.attemptNumber, settings.shuffleOptions, quizKey]);

  const start = () => {
    setError(undefined);
    setMarkers({});
    setUpdated(false);
    if (!draft) {
      saveDraft({
        questions: quiz.questions,
        questionsHash: quiz.questionsHash,
        answers: {},
        attemptNumber: (summary?.attemptsUsed ?? 0) + 1,
      });
    }
    setPhase({ name: 'question', index: 0 });
  };

  const openReview = () => {
    setPhase({ name: 'review' });
    onReview?.();
  };

  const submit = async () => {
    if (!draft) {
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await onSubmit(draft.answers, draft.questionsHash);
      if (result.status === 'submitted') {
        saveDraft(null);
        setSubmitted(result);
        setMarkers({});
        setUpdated(false);
        setPhase({ name: 'result' });
      } else if (result.status === 'error') {
        setError(result.message);
        if (result.closed) {
          saveDraft(null);
          setPhase({ name: 'overview' });
        }
      }
      // 'updated': the reconcile effect takes over once the new questions
      // arrive.
    } finally {
      setSubmitting(false);
    }
  };

  const questions = quiz.questions;
  const answers = draft?.answers ?? {};

  let body: React.ReactNode;
  if (phase.name === 'question' && questions[phase.index]) {
    const question = questions[phase.index];
    body = (
      <QuestionPhase
        question={question}
        options={optionsFor(question)}
        index={phase.index}
        questions={questions}
        answers={answers}
        markers={markers}
        onAnswer={(optionIds) =>
          draft &&
          saveDraft({
            ...draft,
            answers: { ...draft.answers, [question.questionId]: optionIds },
          })
        }
        onReview={openReview}
        setPhase={setPhase}
      />
    );
  } else if (phase.name === 'review') {
    body = (
      <ReviewPhase
        questions={questions}
        answers={answers}
        markers={markers}
        updated={updated}
        submitting={submitting}
        onSubmit={submit}
        setPhase={setPhase}
      />
    );
  } else if (phase.name === 'result' && attempt && summary) {
    body = (
      <ResultPhase
        questions={questions}
        attempt={attempt}
        summary={summary}
        reveal={reveal}
        settings={settings}
        canAttempt={canAttempt}
        onStart={start}
        setPhase={setPhase}
      />
    );
  } else {
    body = (
      <OverviewPhase
        questions={questions}
        attempt={attempt}
        summary={summary}
        settings={settings}
        error={error}
        closedReason={closedReason}
        canAttempt={canAttempt}
        resuming={Boolean(draft)}
        onStart={start}
        setPhase={setPhase}
      />
    );
  }

  return (
    <Card data-slot="quiz-card" className="border-primary/20">
      <CardContent className="space-y-4">
        {error && phase.name !== 'overview' ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn't submit your answers</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {body}
      </CardContent>
    </Card>
  );
}
