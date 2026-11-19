/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Eye, Save } from 'lucide-react';
import type { QuizErrors } from './quiz-form';
import type { SaveError } from './use-quiz-builder-state';

export function QuizSaveBar({
  errors,
  showProblems,
  saveError,
  saving,
  readOnly,
  dirty,
  justSaved,
  onReload,
  onPreview,
  onSave,
  onClose,
}: {
  errors: QuizErrors;
  showProblems: boolean;
  saveError: SaveError | null;
  saving: boolean;
  readOnly: boolean;
  dirty: boolean;
  justSaved: boolean;
  onReload: () => void;
  onPreview: () => void;
  onSave: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="sticky bottom-0 space-y-3 border-t bg-background/95 py-4 backdrop-blur">
      {showProblems && errors.quiz.length > 0 && (
        <ErrorAlert type="error" header="Fix these before saving">
          <ul className="list-disc pl-5">
            {errors.quiz.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </ErrorAlert>
      )}
      {showProblems && Object.keys(errors.questions).length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {Object.keys(errors.questions).length === 1
            ? '1 question needs fixing'
            : `${Object.keys(errors.questions).length} questions need fixing`}{' '}
          before the quiz can be saved.
        </p>
      )}
      {saveError &&
        (saveError.data?.code === 'CONFLICT' ? (
          <ErrorAlert
            type="error"
            header="This quiz changed since you opened it"
          >
            <p>
              Someone saved it in the meantime. Reload to get the latest
              version; your unsaved changes here will be lost.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={onReload}
            >
              Reload the quiz
            </Button>
          </ErrorAlert>
        ) : (
          <ErrorAlert type="error" header="Couldn't save the quiz">
            {saveError.message}
          </ErrorAlert>
        ))}
      <div className="flex items-center justify-end gap-3">
        <span className="text-sm text-muted-foreground" role="status">
          {justSaved ? 'Saved' : dirty ? 'Unsaved changes' : ''}
        </span>
        <Button type="button" variant="outline" onClick={onPreview}>
          <Eye /> Preview as student
        </Button>
        {onClose && (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
        {!readOnly && (
          <Button type="button" disabled={saving} onClick={onSave}>
            <Save /> {saving ? 'Saving…' : 'Save quiz'}
          </Button>
        )}
      </div>
    </div>
  );
}
