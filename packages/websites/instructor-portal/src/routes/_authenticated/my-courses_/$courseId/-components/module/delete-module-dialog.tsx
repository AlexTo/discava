/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { Alert } from '../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { studentActivityNote } from '../student-activity';

export function DeleteModuleDialog({
  courseId,
  moduleId,
  title,
  lessonCount,
  archive,
  usedItems = 0,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  title: string;
  lessonCount: number;
  // Outside a draft course, delete archives the module instead: students
  // stop seeing it, but it and their data for it are kept and restorable.
  archive: boolean;
  // How many of its items students have used, for the warning on archiving.
  usedItems?: number;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { course, module } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: deleteModule,
    reset: resetDeleteModule,
    isPending,
    isError,
    error,
  } = useMutation(module.delete.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetDeleteModule();
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {archive ? 'Archive module' : 'Delete module'}
          </AlertDialogTitle>
          {archive ? (
            <AlertDialogDescription>
              Students will no longer see "{title}" or anything in it. Their
              progress and results are kept, and the module can be restored.
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription>
              Are you sure you want to delete "{title}"?{' '}
              {lessonCount > 0
                ? `This will also delete ${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'} inside it. `
                : ''}
              This can't be undone.
            </AlertDialogDescription>
          )}
          {archive && studentActivityNote({ items: usedItems }) && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {studentActivityNote({ items: usedItems })}. Their progress is
              kept, and counts again if it's restored.
            </p>
          )}
        </AlertDialogHeader>

        {isError && (
          <Alert
            type="error"
            header={
              archive
                ? "Couldn't archive the module"
                : "Couldn't delete the module"
            }
          >
            {apiErrorMessage(error)}
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={archive ? 'default' : 'destructive'}
            disabled={isPending}
            onClick={async () => {
              try {
                await deleteModule({ courseId, moduleId });
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
                ? 'Archiving...'
                : 'Archive module'
              : isPending
                ? 'Deleting...'
                : 'Delete module'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
