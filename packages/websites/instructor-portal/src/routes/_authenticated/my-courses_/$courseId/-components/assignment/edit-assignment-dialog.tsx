/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import {
  dueAtToIso,
  isoToDueAt,
  type UploadAssignmentValues,
  validateUploadAssignment,
} from './assignment-form';
import { UploadAssignmentFields } from './upload-assignment-fields';

// Edits an upload assignment's instructions, max points and due date. Clearing
// the due date removes it. Its title is the lesson's, so it isn't edited here.
export function EditAssignmentDialog({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  body,
  maxPoints,
  dueAt,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  title: string;
  body?: string;
  maxPoints?: number;
  dueAt?: string;
  trigger: ReactNode;
}) {
  const initial = (): UploadAssignmentValues => ({
    title,
    body,
    maxPoints: String(maxPoints ?? ''),
    dueAt: isoToDueAt(dueAt),
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: updateAssignment,
    reset: resetUpdateAssignment,
    isPending,
    isError,
    error,
  } = useMutation(contentItem.updateAssignment.mutationOptions());

  const errors = validateUploadAssignment(values, { withTitle: false });

  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0 || !values.body) {
      return;
    }
    try {
      await updateAssignment({
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        body: values.body,
        maxPoints: Number(values.maxPoints),
        dueAt: dueAtToIso(values.dueAt) ?? null,
      });
    } catch {
      // Surfaced via the error below; keep the dialog open.
      return;
    }
    setOpen(false);
    void queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setValues(initial());
          setShowErrors(false);
        } else {
          resetUpdateAssignment();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit assignment</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {isError && (
            <ErrorAlert type="error" header="Couldn't save the assignment">
              {apiErrorMessage(error)}
            </ErrorAlert>
          )}
          <UploadAssignmentFields
            values={values}
            errors={errors}
            showErrors={showErrors}
            withTitle={false}
            onChange={(next) =>
              setValues((current) => ({ ...current, ...next }))
            }
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
