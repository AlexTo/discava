/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { CirclePlus } from 'lucide-react';
import { QuestionCard, QuestionHandle } from './question-card';
import {
  MAX_QUESTIONS,
  type QuestionState,
  type QuizErrors,
  type QuizState,
} from './quiz-form';
import { sectionId } from './use-quiz-builder-state';

export function SortableQuestionList({
  quiz,
  errors,
  expanded,
  showProblems,
  readOnly,
  onToggle,
  onChangeQuestion,
  onRemove,
  onAdd,
  onDragEnd,
}: {
  quiz: QuizState;
  errors: QuizErrors;
  expanded: string | undefined;
  showProblems: boolean;
  readOnly: boolean;
  onToggle: (questionId: string) => void;
  onChangeQuestion: (question: QuestionState) => void;
  onRemove: (questionId: string) => void;
  onAdd: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  return (
    <section aria-labelledby="quiz-questions" className="space-y-3">
      <h2 id="quiz-questions" className="text-lg font-semibold">
        Questions ({quiz.questions.length})
      </h2>
      <DragDropProvider onDragEnd={onDragEnd}>
        <ol className="space-y-3">
          {quiz.questions.map((question, index) => (
            <SortableQuestion
              key={question.questionId}
              id={question.questionId}
              elementId={sectionId(question.questionId)}
              index={index}
              label={`Question ${index + 1}`}
              disabled={readOnly || quiz.questions.length < 2}
            >
              {(handle) => (
                <QuestionCard
                  question={question}
                  number={index + 1}
                  expanded={expanded === question.questionId}
                  onToggle={() => onToggle(question.questionId)}
                  onChange={onChangeQuestion}
                  onRemove={() => onRemove(question.questionId)}
                  canRemove={quiz.questions.length > 1}
                  problems={
                    showProblems
                      ? (errors.questions[question.questionId] ?? [])
                      : []
                  }
                  readOnly={readOnly}
                  handle={handle}
                />
              )}
            </SortableQuestion>
          ))}
        </ol>
      </DragDropProvider>
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          disabled={quiz.questions.length >= MAX_QUESTIONS}
          onClick={onAdd}
        >
          <CirclePlus /> Add question
        </Button>
      )}
    </section>
  );
}

function SortableQuestion({
  id,
  elementId,
  index,
  label,
  disabled,
  children,
}: {
  id: string;
  elementId: string;
  index: number;
  label: string;
  disabled: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { ref, handleRef } = useSortable({ id, index, disabled });
  // The handle is always rendered, disabled when there's nothing to reorder:
  // without one, dnd-kit makes the whole card the drag source, a (disabled)
  // button to assistive tech, with every field inside it.
  return (
    <li ref={ref} id={elementId} className="scroll-mt-4">
      {children(
        <QuestionHandle
          label={label}
          handleRef={handleRef}
          disabled={disabled}
        />,
      )}
    </li>
  );
}
