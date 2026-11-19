/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { cn } from '@discava/common-shadcn/lib/utils';
import { plainText, type QuizErrors, type QuizState } from './quiz-form';

export function QuizContentsNav({
  quiz,
  errors,
  expanded,
  showProblems,
  onSettings,
  onQuestion,
}: {
  quiz: QuizState;
  errors: QuizErrors;
  expanded: string | undefined;
  showProblems: boolean;
  onSettings: () => void;
  onQuestion: (questionId: string) => void;
}) {
  return (
    <nav
      aria-label="Quiz contents"
      className="sticky top-0 hidden max-h-[calc(90vh-3rem)] self-start overflow-y-auto sm:block"
    >
      <ol className="space-y-0.5 text-sm">
        <li>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onSettings()}
            className="w-full justify-start px-2"
          >
            Settings
          </Button>
        </li>
        {quiz.questions.map((question, index) => {
          const needsFixing =
            showProblems && Boolean(errors.questions[question.questionId]);
          return (
            <li key={question.questionId}>
              <Button
                type="button"
                variant="ghost"
                aria-current={
                  expanded === question.questionId ? 'true' : undefined
                }
                onClick={() => onQuestion(question.questionId)}
                className={cn(
                  'h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left font-normal whitespace-normal',
                  expanded === question.questionId && 'bg-muted',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">
                    Question {index + 1}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {plainText(question.prompt) || 'No question written yet'}
                  </span>
                </span>
                {needsFixing && (
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-destructive">
                    <span className="sr-only">(needs fixing)</span>
                  </span>
                )}
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
