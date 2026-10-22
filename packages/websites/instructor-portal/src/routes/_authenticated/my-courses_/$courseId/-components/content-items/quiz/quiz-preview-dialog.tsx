/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  gradeQuiz,
  type QuizAnswers,
  type QuizSummary,
} from '@discava/common-portal-utils/quiz';
import { QuizCard } from '@discava/common-shadcn/components/quiz-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
import { useMemo, useState } from 'react';
import { type QuizState, toQuizInput } from './quiz-form';

// The quiz as students would see it, from the builder's current state
// (saved or not), in the same card students use. Answers are graded here and
// nothing is sent or saved; the correct answers and explanations are always
// shown, so they can be checked. Its attempts count only while it's open.
export function QuizPreviewDialog({
  quiz,
  open,
  onOpenChange,
}: {
  quiz: QuizState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { title, description, settings, questions, answerKey } = useMemo(
    () => toQuizInput(quiz),
    [quiz],
  );
  const [summary, setSummary] = useState<QuizSummary | null>(null);

  const onSubmit = async (answers: QuizAnswers) => {
    const graded = gradeQuiz(
      questions,
      answerKey,
      settings.passMarkPercent,
      answers,
    );
    const attemptsUsed = (summary?.attemptsUsed ?? 0) + 1;
    const next: QuizSummary = {
      attemptsUsed,
      attemptsAllowed: settings.attemptsAllowed,
      bestScore: Math.max(summary?.bestScore ?? 0, graded.scorePercent),
      passedAt:
        summary?.passedAt ??
        (graded.passed ? new Date().toISOString() : undefined),
    };
    setSummary(next);
    return {
      status: 'submitted' as const,
      attempt: { ...graded, answers, submittedAt: new Date().toISOString() },
      summary: next,
      reveal: answerKey,
    };
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Each preview starts afresh, as a student who hasn't attempted it.
        if (!next) {
          setSummary(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview as student: {title}</DialogTitle>
          <DialogDescription>
            Answers are checked here and nothing is saved. The correct answers
            and explanations are always shown in the preview.
          </DialogDescription>
        </DialogHeader>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
        {open ? (
          <QuizCard
            quiz={{
              title,
              description,
              settings,
              questions,
              questionsHash: 'preview',
            }}
            summary={summary}
            lastAttempt={null}
            reveal={summary ? answerKey : null}
            quizKey="preview"
            saveDrafts={false}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
