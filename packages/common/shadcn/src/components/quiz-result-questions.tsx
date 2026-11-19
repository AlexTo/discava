/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  QuizAttempt,
  QuizQuestion,
  QuizReveal,
} from '@discava/common-web-utils/quiz';
import { cn } from 'cn';
import { CircleCheck, CircleX } from 'lucide-react';
import { RichTextView } from './rich-text-view';

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

// Per question: right or wrong, and once revealed, the correct options, what
// the student chose, and the explanation.
export function ResultQuestions({
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
