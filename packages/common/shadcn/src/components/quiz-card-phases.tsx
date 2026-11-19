/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isAnswered,
  type QuestionMarker,
  type QuizAnswers,
  type QuizAttempt,
  type QuizQuestion,
  type QuizReveal,
  type QuizSettings,
  type QuizSummary,
} from '@discava/common-web-utils/quiz';
import { cn } from 'cn';
import { AlertTriangle, CircleCheck, RotateCcw } from 'lucide-react';
import { QuizMarkerBadge } from './quiz-marker-badge';
import { QuestionScreen } from './quiz-question-screen';
import { ResultQuestions } from './quiz-result-questions';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

export type Phase =
  | { name: 'overview' }
  | { name: 'question'; index: number }
  | { name: 'review' }
  | { name: 'result' };

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export function QuestionPhase({
  question,
  options,
  index,
  questions,
  answers,
  markers,
  onAnswer,
  onReview,
  setPhase,
}: {
  question: QuizQuestion;
  options: QuizQuestion['options'];
  index: number;
  questions: QuizQuestion[];
  answers: QuizAnswers;
  markers: Record<string, QuestionMarker>;
  onAnswer: (optionIds: string[]) => void;
  onReview: () => void;
  setPhase: (phase: Phase) => void;
}) {
  const last = index === questions.length - 1;
  return (
    <div className="space-y-5">
      <nav aria-label="Questions" className="flex flex-wrap gap-1.5">
        {questions.map((q, i) => (
          <button
            key={q.questionId}
            type="button"
            onClick={() => setPhase({ name: 'question', index: i })}
            aria-current={i === index ? 'step' : undefined}
            aria-label={`Question ${i + 1}${isAnswered(answers, q.questionId) ? ', answered' : ''}${markers[q.questionId] ? `, ${markers[q.questionId]}` : ''}`}
            className={cn(
              'size-3 rounded-full border border-primary/40 transition-colors',
              isAnswered(answers, q.questionId) && 'bg-primary/60',
              i === index && 'ring-2 ring-primary ring-offset-2',
            )}
          />
        ))}
      </nav>
      <QuestionScreen
        question={question}
        options={options}
        number={index + 1}
        total={questions.length}
        answer={answers[question.questionId] ?? []}
        marker={markers[question.questionId]}
        onAnswer={onAnswer}
      />
      <div className="flex justify-between gap-3">
        <Button
          variant="outline"
          disabled={index === 0}
          onClick={() => setPhase({ name: 'question', index: index - 1 })}
        >
          Back
        </Button>
        {last ? (
          <Button onClick={onReview}>Review answers</Button>
        ) : (
          <Button
            onClick={() => setPhase({ name: 'question', index: index + 1 })}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

export function ReviewPhase({
  questions,
  answers,
  markers,
  updated,
  submitting,
  onSubmit,
  setPhase,
}: {
  questions: QuizQuestion[];
  answers: QuizAnswers;
  markers: Record<string, QuestionMarker>;
  updated: boolean;
  submitting: boolean;
  onSubmit: () => void;
  setPhase: (phase: Phase) => void;
}) {
  const answeredCount = questions.filter((q) =>
    isAnswered(answers, q.questionId),
  ).length;
  return (
    <div className="space-y-4">
      {updated ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>This quiz was updated</AlertTitle>
          <AlertDescription>
            Check the marked questions before submitting.
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {answeredCount} of {count(questions.length, 'question', 'questions')}{' '}
        answered. Unanswered questions are marked incorrect.
      </p>
      <ol className="divide-y rounded-lg border">
        {questions.map((q, i) => (
          <li
            key={q.questionId}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <span className="flex items-center gap-2 text-sm">
              Question {i + 1}{' '}
              <QuizMarkerBadge marker={markers[q.questionId]} />
            </span>
            <span className="flex items-center gap-3">
              {isAnswered(answers, q.questionId) ? (
                <span className="text-xs text-muted-foreground">Answered</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  Unanswered
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPhase({ name: 'question', index: i })}
                aria-label={`Change your answer to question ${i + 1}`}
              >
                Change
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex justify-between gap-3">
        <Button
          variant="outline"
          onClick={() =>
            setPhase({ name: 'question', index: questions.length - 1 })
          }
        >
          Back
        </Button>
        <Button disabled={submitting} onClick={onSubmit}>
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}

export function ResultPhase({
  questions,
  attempt,
  summary,
  reveal,
  settings,
  canAttempt,
  onStart,
  setPhase,
}: {
  questions: QuizQuestion[];
  attempt: QuizAttempt;
  summary: QuizSummary;
  reveal: QuizReveal | null;
  settings: QuizSettings;
  canAttempt: boolean;
  onStart: () => void;
  setPhase: (phase: Phase) => void;
}) {
  const lower = attempt.scorePercent < summary.bestScore;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-lg font-semibold">
          This attempt: {attempt.scorePercent}%{' '}
          {attempt.passed ? (
            <span className="text-emerald-700 dark:text-emerald-300">
              · Passed
            </span>
          ) : (
            <span className="text-muted-foreground">· Not passed</span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {lower
            ? `Your best score of ${summary.bestScore}% still counts.`
            : `Pass mark: ${settings.passMarkPercent}%.`}
        </p>
      </div>
      <ResultQuestions
        questions={questions}
        attempt={attempt}
        reveal={reveal}
      />
      {!reveal && settings.revealAnswers !== 'never' ? (
        <p className="text-sm text-muted-foreground">
          The correct answers are shown once you've used all your attempts.
        </p>
      ) : null}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => setPhase({ name: 'overview' })}
        >
          Done
        </Button>
        {canAttempt ? (
          <Button onClick={onStart}>
            <RotateCcw className="size-4" /> Retake quiz
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function OverviewPhase({
  questions,
  attempt,
  summary,
  settings,
  error,
  closedReason,
  canAttempt,
  resuming,
  onStart,
  setPhase,
}: {
  questions: QuizQuestion[];
  attempt: QuizAttempt | null;
  summary: QuizSummary | null;
  settings: QuizSettings;
  error: string | undefined;
  closedReason: string | undefined;
  canAttempt: boolean;
  // A draft is saved to pick up.
  resuming: boolean;
  onStart: () => void;
  setPhase: (phase: Phase) => void;
}) {
  const attemptsLabel =
    settings.attemptsAllowed === null
      ? 'Unlimited attempts'
      : `${summary?.attemptsUsed ?? 0} of ${count(settings.attemptsAllowed, 'attempt', 'attempts')} used`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {count(questions.length, 'question', 'questions')} · Pass{' '}
        {settings.passMarkPercent}% · {attemptsLabel}
      </p>
      {summary ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Best score:{' '}
          <span className="font-semibold">{summary.bestScore}%</span>
          {summary.passedAt ? (
            <Badge
              variant="secondary"
              className="gap-1 border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
            >
              <CircleCheck className="size-3.5" /> Passed
            </Badge>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't submit your answers</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {closedReason ? (
        <p className="text-sm text-muted-foreground">{closedReason}</p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        {attempt && summary ? (
          <Button
            variant="outline"
            onClick={() => setPhase({ name: 'result' })}
          >
            See your last result
          </Button>
        ) : null}
        {canAttempt ? (
          <Button onClick={onStart}>
            {resuming ? 'Resume quiz' : summary ? 'Retake quiz' : 'Start quiz'}
          </Button>
        ) : !closedReason ? (
          <Button disabled>No attempts remaining</Button>
        ) : null}
      </div>
    </div>
  );
}
