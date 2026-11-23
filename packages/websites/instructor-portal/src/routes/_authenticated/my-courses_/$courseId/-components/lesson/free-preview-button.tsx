/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { useReturnFocus } from '@discava/common-shadcn/hooks/use-return-focus';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

// Marks an ordinary lesson as a free preview, after a confirmation, or removes
// the mark at once. An assignment lesson or an archived one is given no
// control by the caller.
export function FreePreviewButton({
  courseId,
  moduleId,
  lessonId,
  title,
  freePreview,
  className,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  title: string;
  freePreview: boolean;
  className?: string;
}) {
  const { course, lesson } = useInstructorApi();
  const queryClient = useQueryClient();
  const mutation = useMutation(lesson.setFreePreview.mutationOptions());
  const [open, setOpen] = useState(false);
  const { onCloseAutoFocus } = useReturnFocus(open);

  const set = async (next: boolean) => {
    await mutation.mutateAsync({
      courseId,
      moduleId,
      lessonId,
      freePreview: next,
    });
    await queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
  };

  // One button for both states, so focus never moves when the mark changes:
  // marking asks first, removing the mark is immediate.
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={className}
        disabled={freePreview && mutation.isPending}
        onClick={() =>
          freePreview ? void set(false).catch(() => {}) : setOpen(true)
        }
      >
        {freePreview ? 'Remove free preview' : 'Make free preview'}
      </Button>
      {freePreview && mutation.isError && (
        <ErrorAlert type="error" header="Couldn't remove the free preview">
          {apiErrorMessage(mutation.error)}
        </ErrorAlert>
      )}
      <AlertDialog
        open={open && !freePreview}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            mutation.reset();
          }
        }}
      >
        <AlertDialogContent
          className="sm:max-w-md"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Make free preview</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone will be able to open this lesson without enrolling or
              paying: its videos, text and files. Quizzes stay locked.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {mutation.isError && (
            <ErrorAlert type="error" header="Couldn't make the free preview">
              {apiErrorMessage(mutation.error)}
            </ErrorAlert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={async () => {
                try {
                  await set(true);
                } catch {
                  // Surfaced via the error above; keep the dialog open.
                  return;
                }
                setOpen(false);
              }}
            >
              {mutation.isPending ? 'Saving…' : 'Make free preview'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
