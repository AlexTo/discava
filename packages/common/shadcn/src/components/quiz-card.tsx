/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  attemptsRemain,
  isAnswered,
  type QuestionMarker,
  type Quiz,
  type QuizAnswers,
  type QuizAttempt,
  type QuizQuestion,
  type QuizReveal,
  type QuizSummary,
  reconcile,
  shuffled,
} from '@discava/common-portal-utils/quiz';
import { cn } from 'cn';
import { AlertTriangle, CircleCheck, CircleX, RotateCcw } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { RichTextView } from './rich-text-view';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

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

// An attempt in progress, as saved between page loads.
interface Draft {
  // The questions as the student saw them, to reconcile against.
  questions: QuizQuestion[];
  questionsHash: string;
  answers: QuizAnswers;
  attemptNumber: number;
}

const draftKey = (quizKey: string) => `discava:quiz-draft:${quizKey}`;

// localStorage can be missing or throw (private mode, blocked storage): a
// draft is a convenience, so failing to read or write one is ignored.
const readDraft = (quizKey: string): Draft | null => {
  try {
    const raw = localStorage.getItem(draftKey(quizKey));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
};
const writeDraft = (quizKey: string, draft: Draft | null) => {
  try {
    if (draft) {
      localStorage.setItem(draftKey(quizKey), JSON.stringify(draft));
    } else {
      localStorage.removeItem(draftKey(quizKey));
    }
  } catch {}
};

type Phase =
  | { name: 'overview' }
  | { name: 'question'; index: number }
  | { name: 'review' }
  | { name: 'result' };

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function MarkerBadge({ marker }: { marker?: QuestionMarker }) {
  if (!marker) {
    return null;
  }
  return (
    <Badge variant="secondary" className="text-xs">
      {marker === 'new' ? 'New' : 'Updated'}
    </Badge>
  );
}

// Right or wrong, with an icon and words, never colour alone.
function Verdict({ correct }: { correct: boolean }) {
  return correct ? (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
      <CircleCheck className="size-4" aria-hidden="true" /> Correct
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-300">
      <CircleX className="size-4" aria-hidden="true" /> Incorrect
    </span>
  );
}

function QuestionScreen({
  question,
  options,
  number,
  total,
  answer,
  marker,
  onAnswer,
}: {
  question: QuizQuestion;
  options: QuizQuestion['options'];
  number: number;
  total: number;
  answer: string[];
  marker?: QuestionMarker;
  onAnswer: (optionIds: string[]) => void;
}) {
  const id = useId();
  const multiple = question.kind === 'multiple';
  return (
    <fieldset aria-labelledby={`${id}-legend`} className="space-y-4">
      <div id={`${id}-legend`} className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Question {number} of {total} <MarkerBadge marker={marker} />
        </p>
        <RichTextView value={question.prompt} className="prose-base" />
        {multiple ? (
          <p className="text-sm font-medium">Select all that apply</p>
        ) : null}
      </div>
      {multiple ? (
        <div className="grid gap-2">
          {options.map((option) => (
            <Label
              key={option.optionId}
              htmlFor={`${id}-${option.optionId}`}
              className="cursor-pointer gap-3 rounded-lg border px-3.5 py-2.5 font-normal leading-normal hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <Checkbox
                id={`${id}-${option.optionId}`}
                checked={answer.includes(option.optionId)}
                onCheckedChange={(checked) =>
                  onAnswer(
                    checked
                      ? [...answer, option.optionId]
                      : answer.filter((o) => o !== option.optionId),
                  )
                }
              />
              {option.text}
            </Label>
          ))}
        </div>
      ) : (
        <RadioGroup
          className="gap-2"
          value={answer[0] ?? ''}
          onValueChange={(optionId) => onAnswer([optionId])}
        >
          {options.map((option) => (
            <Label
              key={option.optionId}
              htmlFor={`${id}-${option.optionId}`}
              className="cursor-pointer gap-3 rounded-lg border px-3.5 py-2.5 font-normal leading-normal hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem
                id={`${id}-${option.optionId}`}
                value={option.optionId}
              />
              {option.text}
            </Label>
          ))}
        </RadioGroup>
      )}
    </fieldset>
  );
}

// Per question: right or wrong, and once revealed, the correct options, what
// the student chose, and the explanation.
function ResultQuestions({
  questions,
  attempt,
  reveal,
}: {
  questions: QuizQuestion[];
  attempt: QuizAttempt;
  reveal: QuizReveal | null;
}) {
  const correct = new Set(attempt.correctQuestionIds);
  return (
    <ol className="space-y-4">
      {questions.map((question, index) => {
        const revealed = reveal?.[question.questionId];
        const chosen = new Set(attempt.answers[question.questionId] ?? []);
        return (
          <li
            key={question.questionId}
            className="space-y-2 rounded-lg border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                Question {index + 1}
              </p>
              <Verdict correct={correct.has(question.questionId)} />
            </div>
            <RichTextView value={question.prompt} />
            {revealed ? (
              <>
                <ul className="space-y-1 text-sm">
                  {question.options.map((option) => {
                    const right = revealed.correctOptionIds.includes(
                      option.optionId,
                    );
                    return (
                      <li
                        key={option.optionId}
                        className={cn(
                          'flex items-center gap-2',
                          right && 'font-medium',
                        )}
                      >
                        {right ? (
                          <CircleCheck
                            className="size-4 text-emerald-600"
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="size-4" aria-hidden="true" />
                        )}
                        {option.text}
                        {right ? (
                          <span className="sr-only">(correct answer)</span>
                        ) : null}
                        {chosen.has(option.optionId) ? (
                          <span className="text-xs text-muted-foreground">
                            (your answer)
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {revealed.explanation ? (
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Explanation
                    </p>
                    <RichTextView value={revealed.explanation} />
                  </div>
                ) : null}
              </>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A quiz as a card in a lesson: an overview, then one question per screen
 * with a dot navigator, a review step, and the result. Grading happens in
 * `onSubmit` (core-api for students; locally in the instructor's preview),
 * and feedback only ever comes after submitting.
 *
 * If the questions change while the student is answering (a new `quiz` with
 * a different `questionsHash`, or `onSubmit` reporting `updated`), their
 * answers are carried over (see reconcile in @discava/common-portal-utils/quiz), changed questions
 * are marked New or Updated, and the review screen says so.
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
  const [draft, setDraft] = useState<Draft | null>(() =>
    saveDrafts ? readDraft(quizKey) : null,
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

  const saveDraft = (next: Draft | null) => {
    setDraft(next);
    if (saveDrafts) {
      writeDraft(quizKey, next);
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
  const answeredCount = questions.filter((q) =>
    isAnswered(answers, q.questionId),
  ).length;

  let body: React.ReactNode;
  if (phase.name === 'question' && questions[phase.index]) {
    const { index } = phase;
    const question = questions[index];
    const last = index === questions.length - 1;
    body = (
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
          options={optionsFor(question)}
          number={index + 1}
          total={questions.length}
          answer={answers[question.questionId] ?? []}
          marker={markers[question.questionId]}
          onAnswer={(optionIds) =>
            draft &&
            saveDraft({
              ...draft,
              answers: { ...draft.answers, [question.questionId]: optionIds },
            })
          }
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
            <Button onClick={openReview}>Review answers</Button>
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
  } else if (phase.name === 'review') {
    body = (
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
                Question {i + 1} <MarkerBadge marker={markers[q.questionId]} />
              </span>
              <span className="flex items-center gap-3">
                {isAnswered(answers, q.questionId) ? (
                  <span className="text-xs text-muted-foreground">
                    Answered
                  </span>
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
          <Button disabled={submitting} onClick={submit}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </div>
    );
  } else if (phase.name === 'result' && attempt && summary) {
    const lower = attempt.scorePercent < summary.bestScore;
    body = (
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
            <Button onClick={start}>
              <RotateCcw className="size-4" /> Retake quiz
            </Button>
          ) : null}
        </div>
      </div>
    );
  } else {
    const attemptsLabel =
      settings.attemptsAllowed === null
        ? 'Unlimited attempts'
        : `${summary?.attemptsUsed ?? 0} of ${count(settings.attemptsAllowed, 'attempt', 'attempts')} used`;
    body = (
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
            <Button onClick={start}>
              {draft ? 'Resume quiz' : summary ? 'Retake quiz' : 'Start quiz'}
            </Button>
          ) : !closedReason ? (
            <Button disabled>No attempts remaining</Button>
          ) : null}
        </div>
      </div>
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
