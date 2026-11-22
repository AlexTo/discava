/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
'use client';

import {
  isCorrectAnswer,
  type VideoAnswer,
  type VideoQuestion,
} from '@discava/common-web-utils/video-questions';
import { cn } from 'cn';
import { CircleCheck, CircleX, Loader2Icon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { QuestionOptions } from './quiz-question-screen';
import { RichTextView } from './rich-text-view';
import { Button } from './ui/button';
import { formatTime } from './video-controls';

// What a question asks of the viewer, in the player's overlay: unanswered
// (choose, submit or skip), submitting, failed to save, answered (the verdict,
// the correct options and the explanation) and practising (try again without
// recording). Presentational: the controller holds what is open and calls
// the API.
export function VideoQuestionCard({
  question,
  position,
  answer,
  pending = false,
  error,
  updated = false,
  review = false,
  onSubmit,
  onSkip,
  onContinue,
  onTryAgain,
}: {
  question: VideoQuestion;
  // For an end check: "Question 1 of 2".
  position?: { number: number; total: number };
  // The recorded answer, once there is one.
  answer?: VideoAnswer;
  // The answer is being saved.
  pending?: boolean;
  // Why saving failed, if it did; the choice is kept.
  error?: string;
  // Shows "This question was updated".
  updated?: boolean;
  // Opened from its marker rather than asked in playback: the answered view
  // closes instead of continuing.
  review?: boolean;
  onSubmit: (optionIds: string[]) => void;
  onSkip: () => void;
  onContinue: () => void;
  onTryAgain?: () => void;
}) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  // Practising: a choice graded here against the recorded answer's key.
  const [practising, setPracticing] = useState(false);
  const [practiceChecked, setPracticeChecked] = useState(false);
  const multiple = question.kind === 'multiple';
  const optionIds = new Set(question.options.map((o) => o.optionId));
  // An edit can remove an option the learner had chosen.
  const selected = chosen.filter((optionId) => optionIds.has(optionId));

  const showResult = Boolean(answer) && (!practising || practiceChecked);
  const shown = practising && answer ? selected : (answer?.optionIds ?? []);
  const correct =
    answer &&
    (practising
      ? isCorrectAnswer(selected, answer.correctOptionIds)
      : answer.correct);

  // Each state is a new screen: its heading takes focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus moves when the state changes, not on every render
  useEffect(() => {
    headingRef.current?.focus();
  }, [question.questionId, showResult, Boolean(error)]);

  const heading = position
    ? `Question ${position.number} of ${position.total}`
    : question.atSeconds === null
      ? 'Question at the end'
      : `Question at ${formatTime(question.atSeconds)}`;

  const startPractice = () => {
    setChosen([]);
    setPracticeChecked(false);
    setPracticing(true);
    onTryAgain?.();
  };

  return (
    <div
      data-slot="video-question-card"
      className="mx-auto my-3 w-[calc(100%-1.5rem)] max-w-2xl min-w-0 space-y-4 rounded-lg bg-background p-4 text-foreground shadow-lg"
    >
      <h2
        ref={headingRef}
        data-autofocus
        tabIndex={-1}
        className="text-xs font-medium text-muted-foreground outline-none"
      >
        {heading}
      </h2>
      {updated && (
        <p role="status" className="text-sm font-medium">
          This question was updated. Check it before answering.
        </p>
      )}
      {practising && (
        <p className="text-sm text-muted-foreground">
          Practice: this answer isn't recorded
        </p>
      )}
      <RichTextView value={question.prompt} className="prose-base" />

      {showResult && answer ? (
        <>
          <div role="status" className="space-y-3">
            <p
              className={cn(
                'inline-flex items-center gap-1 text-sm font-medium',
                correct
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-red-700 dark:text-red-300',
              )}
            >
              {correct ? (
                <CircleCheck className="size-4" aria-hidden="true" />
              ) : (
                <CircleX className="size-4" aria-hidden="true" />
              )}
              {correct ? 'Correct' : 'Not quite'}
            </p>
          </div>
          <ul className="space-y-1 text-sm">
            {question.options.map((option) => {
              const right = answer.correctOptionIds.includes(option.optionId);
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
                      className="size-4 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  {option.text}
                  {right ? (
                    <span className="sr-only">(correct answer)</span>
                  ) : null}
                  {shown.includes(option.optionId) ? (
                    <span className="text-xs text-muted-foreground">
                      (your answer)
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {answer.explanation ? (
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                Explanation
              </p>
              <RichTextView value={answer.explanation} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onContinue}>
              {practising || review ? 'Close' : 'Continue'}
            </Button>
            <Button type="button" variant="outline" onClick={startPractice}>
              Try again
            </Button>
          </div>
        </>
      ) : (
        <>
          <fieldset
            aria-labelledby={`${id}-legend`}
            disabled={pending}
            className="space-y-3"
          >
            <legend id={`${id}-legend`} className="sr-only">
              {heading}
            </legend>
            {multiple ? (
              <p className="text-sm font-medium">Select all that apply</p>
            ) : null}
            <QuestionOptions
              idPrefix={id}
              multiple={multiple}
              options={question.options}
              answer={selected}
              disabled={pending}
              onAnswer={setChosen}
            />
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {practising ? (
              <>
                <Button
                  type="button"
                  disabled={selected.length === 0}
                  onClick={() => setPracticeChecked(true)}
                >
                  Check answer
                </Button>
                <Button type="button" variant="outline" onClick={onContinue}>
                  Close
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  disabled={pending || selected.length === 0}
                  onClick={() => onSubmit(selected)}
                >
                  {pending ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {error && !pending ? 'Try again' : 'Submit answer'}
                </Button>
                <Button type="button" variant="outline" onClick={onSkip}>
                  Skip
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
