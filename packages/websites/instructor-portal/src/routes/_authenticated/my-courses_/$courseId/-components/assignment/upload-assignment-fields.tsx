/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { RichTextEditor } from '../rich-text-editor';
import {
  MAX_ASSIGNMENT_POINTS,
  type UploadAssignmentErrors,
  type UploadAssignmentValues,
} from './assignment-form';

// The fields of an upload assignment: instructions, max points and an
// optional due date, with a title when the assignment is being created.
// Problems show once `showErrors` is set (after a first try to save).
export function UploadAssignmentFields({
  values,
  errors,
  showErrors,
  withTitle,
  onChange,
}: {
  values: UploadAssignmentValues;
  errors: UploadAssignmentErrors;
  showErrors: boolean;
  withTitle: boolean;
  onChange: (next: Partial<UploadAssignmentValues>) => void;
}) {
  const invalid = (field: keyof UploadAssignmentValues) =>
    showErrors && Boolean(errors[field]);
  const errorId = (field: keyof UploadAssignmentValues) =>
    invalid(field) ? `assignment-${field}-error` : undefined;
  const problem = (field: keyof UploadAssignmentValues) =>
    invalid(field) ? (
      <p id={errorId(field)} className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;

  return (
    <>
      {withTitle && (
        <div className="space-y-2">
          <Label htmlFor="assignment-title">Assignment title</Label>
          <Input
            id="assignment-title"
            value={values.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="e.g. Essay: the causes of the war"
            aria-invalid={invalid('title')}
            aria-describedby={errorId('title')}
            autoFocus
          />
          {problem('title')}
        </div>
      )}

      <div className="space-y-2">
        <span className="text-sm font-medium leading-none">Instructions</span>
        <RichTextEditor
          value={values.body}
          onChange={(body) => onChange({ body })}
          ariaLabel="Instructions"
          invalid={invalid('body')}
          describedBy={errorId('body')}
        />
        {problem('body')}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="assignment-max-points">Max points</Label>
          <Input
            id="assignment-max-points"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ASSIGNMENT_POINTS}
            step={1}
            value={values.maxPoints}
            onChange={(event) => onChange({ maxPoints: event.target.value })}
            aria-invalid={invalid('maxPoints')}
            aria-describedby={errorId('maxPoints')}
          />
          {problem('maxPoints')}
        </div>
        <div className="space-y-2">
          <Label htmlFor="assignment-due-at">Due date (optional)</Label>
          <Input
            id="assignment-due-at"
            type="datetime-local"
            value={values.dueAt}
            onChange={(event) => onChange({ dueAt: event.target.value })}
            aria-invalid={invalid('dueAt')}
            aria-describedby={errorId('dueAt')}
          />
          {problem('dueAt')}
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Work submitted after the due date is accepted and marked late.
      </p>
    </>
  );
}
