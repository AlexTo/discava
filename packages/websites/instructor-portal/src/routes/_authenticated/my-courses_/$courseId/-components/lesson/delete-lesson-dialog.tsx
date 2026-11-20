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
  AlertDialogTrigger,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { studentActivityNote } from '../student-activity';

export function DeleteLessonDialog({
  courseId,
  moduleId,
  lessonId,
  title,
  archive,
  usedItems = 0,
  noun = 'lesson',
  trigger,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  title: string;
  // Outside a draft course, delete archives the lesson instead: students
  // stop seeing it, but it and their data for it are kept and restorable.
  archive: boolean;
  // How many of its items students have used, for the warning on archiving.
  usedItems?: number;
  // What the lesson is called: 'lesson', or 'assignment'.
  noun?: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { course, lesson } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: deleteLesson,
    reset: resetDeleteLesson,
    isPending,
    isError,
    error,
  } = useMutation(lesson.delete.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetDeleteLesson();
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {archive ? `Archive ${noun}` : `Delete ${noun}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {archive
              ? `Students will no longer see "${title}" or its content. Their progress and results are kept, and the ${noun} can be restored.`
              : `Are you sure you want to delete "${title}"? This can't be undone.`}
          </AlertDialogDescription>
          {archive && studentActivityNote({ items: usedItems }) && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {studentActivityNote({ items: usedItems })}. Their progress is
              kept, and counts again if it's restored.
            </p>
          )}
        </AlertDialogHeader>

        {isError && (
          <ErrorAlert
            type="error"
            header={
              archive
                ? `Couldn't archive the ${noun}`
                : `Couldn't delete the ${noun}`
            }
          >
            {apiErrorMessage(error)}
          </ErrorAlert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={archive ? 'default' : 'destructive'}
            disabled={isPending}
            onClick={async () => {
              try {
                await deleteLesson({ courseId, moduleId, lessonId });
              } catch {
                // Surfaced via the error above; keep the dialog open.
                return;
              }
              setOpen(false);
              void queryClient.invalidateQueries({
                queryKey: course.view.queryKey({ courseId }),
              });
            }}
          >
            {archive
              ? isPending
                ? 'Archiving…'
                : `Archive ${noun}`
              : isPending
                ? 'Deleting…'
                : `Delete ${noun}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
