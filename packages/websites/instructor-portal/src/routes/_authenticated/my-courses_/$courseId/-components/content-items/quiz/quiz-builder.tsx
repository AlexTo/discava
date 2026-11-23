/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { QuizContentsNav } from './quiz-contents-nav';
import type { QuizItem } from './quiz-form';
import { QuizPreviewDialog } from './quiz-preview-dialog';
import { QuizSaveBar } from './quiz-save-bar';
import { QuizSettingsSection } from './quiz-settings-section';
import { SortableQuestionList } from './sortable-question-list';
import { useQuizBuilderState } from './use-quiz-builder-state';

// Builds a new quiz or edits an existing one. The whole quiz -- settings,
// questions and answer key -- is saved together, so a save never pairs a new
// key with old questions.
export function QuizBuilder({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  quiz: existing,
  studentActivityCount = 0,
  readOnlyReason,
  onDirtyChange,
  onCreated,
  onAssignmentCreated,
  onReload,
  onClose,
}: {
  courseId: string;
  moduleId: string;
  // Absent for a new quiz assignment, whose lesson doesn't exist yet.
  lessonId?: string;
  // Absent for a new quiz.
  contentItemId?: string;
  quiz?: QuizItem;
  // Students who have attempted it, for the warning about editing it.
  studentActivityCount?: number;
  // Why the quiz can't be edited (an archived course, module, lesson or
  // quiz), or nothing if it can.
  readOnlyReason?: string;
  // Whether there are unsaved changes, whenever that changes.
  onDirtyChange?: (dirty: boolean) => void;
  // After the first save of a new quiz, with the id it was given.
  onCreated?: (contentItemId: string) => void;
  // Saving creates a quiz assignment in the module, then calls this.
  onAssignmentCreated?: () => void;
  // Fetches the quiz again, after a CONFLICT.
  onReload: () => void;
  // Shows a Close button beside Save, for a builder in a dialog.
  onClose?: () => void;
}) {
  const readOnly = Boolean(readOnlyReason);
  const state = useQuizBuilderState({
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    quiz: existing,
    readOnly,
    onDirtyChange,
    onCreated,
    onAssignmentCreated,
  });
  const { quiz, errors, expanded, showProblems } = state;

  return (
    <div ref={state.rootRef} className="space-y-6">
      {readOnlyReason && (
        <ErrorAlert header="This quiz can't be edited">
          {readOnlyReason}
        </ErrorAlert>
      )}
      {!readOnly && studentActivityCount > 0 && (
        <ErrorAlert
          header={`${studentActivityCount} ${studentActivityCount === 1 ? 'student has' : 'students have'} attempted this quiz`}
        >
          Their attempts and best scores are kept, and never regraded. Changing
          the questions makes anyone mid-attempt review the quiz before
          submitting; changing only the answer key or explanations doesn't
          interrupt them.
        </ErrorAlert>
      )}

      <div className="sm:grid sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6">
        <QuizContentsNav
          quiz={quiz}
          errors={errors}
          expanded={expanded}
          showProblems={showProblems}
          onSettings={() => state.setScrollTarget('settings')}
          onQuestion={state.jumpTo}
        />
        <div className="min-w-0 space-y-6">
          <QuizSettingsSection
            quiz={quiz}
            readOnly={readOnly}
            onChange={state.change}
            onChangeSettings={state.changeSettings}
            titleInvalid={
              showProblems &&
              errors.quiz.some((problem) => /title/i.test(problem))
            }
          />
          <SortableQuestionList
            quiz={quiz}
            errors={errors}
            expanded={expanded}
            showProblems={showProblems}
            readOnly={readOnly}
            onToggle={state.toggleQuestion}
            onChangeQuestion={state.changeQuestion}
            onRemove={state.removeQuestion}
            onAdd={state.addQuestion}
            onDragEnd={state.onDragEnd}
          />
        </div>
      </div>

      {(!readOnly || onClose) && (
        <QuizSaveBar
          errors={errors}
          showProblems={showProblems}
          saveError={state.saveError}
          saving={state.saving}
          readOnly={readOnly}
          dirty={state.dirty}
          justSaved={state.justSaved}
          onReload={onReload}
          onPreview={state.preview}
          onSave={state.save}
          onClose={onClose}
        />
      )}
      <QuizPreviewDialog
        quiz={quiz}
        open={state.previewOpen}
        onOpenChange={state.setPreviewOpen}
      />
    </div>
  );
}
