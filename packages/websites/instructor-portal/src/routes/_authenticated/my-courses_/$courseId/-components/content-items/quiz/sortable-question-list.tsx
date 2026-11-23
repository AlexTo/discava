/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { Accessibility, defaultPreset } from '@dnd-kit/dom';
import {
  DragDropProvider,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { CirclePlus } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { QuestionCard, QuestionHandle } from './question-card';
import {
  MAX_QUESTIONS,
  plainText,
  type QuestionState,
  type QuizErrors,
  type QuizState,
} from './quiz-form';
import { sectionId } from './use-quiz-builder-state';

// The id of a question's reorder handle, to focus it after a drop.
export const handleId = (questionId: string) => `quiz-handle-${questionId}`;

const PROMPT_EXCERPT = 40;

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
  // The announcements read the latest questions through a ref, so the plugin
  // list stays the same object across renders (a change would rebuild the
  // screen reader plugin mid-drag).
  const latest = useRef(quiz.questions);
  latest.current = quiz.questions;
  const plugins = useMemo(() => {
    type Source = DragStartEvent['operation']['source'];
    // "Question 2: What is the capital…", never the raw id.
    const nameOf = (source: Source) => {
      const index = latest.current.findIndex(
        ({ questionId }) => questionId === String(source?.id),
      );
      if (index < 0) {
        return 'Question';
      }
      const prompt = plainText(latest.current[index].prompt);
      const excerpt =
        prompt.length > PROMPT_EXCERPT
          ? `${prompt.slice(0, PROMPT_EXCERPT)}…`
          : prompt;
      return excerpt
        ? `Question ${index + 1}: ${excerpt}`
        : `Question ${index + 1}`;
    };
    const count = () => latest.current.length;
    const positionOf = (source: Source, initial = false) =>
      isSortable(source)
        ? (initial ? source.initialIndex : source.index) + 1
        : undefined;
    return [
      ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
      Accessibility.configure({
        screenReaderInstructions: {
          draggable:
            'To pick up a question, press Space or Enter. Use the arrow keys to move it, then press Space or Enter to drop it, or Escape to cancel.',
        },
        announcements: {
          dragstart: ({ operation: { source } }: DragStartEvent) =>
            `Picked up ${nameOf(source)}, position ${positionOf(source)} of ${count()}.`,
          dragover: ({ operation: { source } }: DragOverEvent) =>
            `${nameOf(source)} moved to position ${positionOf(source)} of ${count()}.`,
          dragend: ({ operation: { source }, canceled }: DragEndEvent) =>
            canceled
              ? `Moving ${nameOf(source)} was cancelled. It is back at position ${positionOf(source, true)} of ${count()}.`
              : `${nameOf(source)} dropped at position ${positionOf(source)} of ${count()}.`,
        },
      }),
    ];
  }, []);

  const dropped = (event: DragEndEvent) => {
    onDragEnd(event);
    const id = event.operation.source?.id;
    if (id !== undefined) {
      // Once the list has re-rendered in its new order.
      setTimeout(() => document.getElementById(handleId(String(id)))?.focus());
    }
  };

  return (
    <section aria-labelledby="quiz-questions" className="space-y-3">
      <h2 id="quiz-questions" className="text-lg font-semibold">
        Questions ({quiz.questions.length})
      </h2>
      <DragDropProvider plugins={plugins} onDragEnd={dropped}>
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
          id={handleId(id)}
          label={label}
          handleRef={handleRef}
          disabled={disabled}
        />,
      )}
    </li>
  );
}
