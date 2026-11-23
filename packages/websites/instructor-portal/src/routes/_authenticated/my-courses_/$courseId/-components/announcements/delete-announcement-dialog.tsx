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
import { type ReactNode, useRef, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

export function DeleteAnnouncementDialog({
  courseId,
  announcementId,
  title,
  trigger,
  onDeleted,
}: {
  courseId: string;
  announcementId: string;
  title: string;
  trigger: ReactNode;
  /** Called once the dialog has closed after a delete, to place focus. */
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const deletedRef = useRef(false);
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: deleteAnnouncement,
    reset,
    isPending,
    isError,
    error,
  } = useMutation(trpc.announcement.delete.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          reset();
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          // The trigger is gone: the caller says where focus goes.
          if (deletedRef.current) {
            deletedRef.current = false;
            event.preventDefault();
            onDeleted?.();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete announcement</AlertDialogTitle>
          <AlertDialogDescription>
            {`Are you sure you want to delete "${title}"? This can't be undone. Students keep the notification they already received.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isError && (
          <ErrorAlert type="error" header="Couldn't delete the announcement">
            {apiErrorMessage(error)}
          </ErrorAlert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={async () => {
              try {
                await deleteAnnouncement({ courseId, announcementId });
              } catch (deleteError) {
                // Already gone counts as deleted; anything else is shown above.
                const code = (deleteError as { data?: { code?: string } }).data
                  ?.code;
                if (code !== 'NOT_FOUND') {
                  return;
                }
              }
              deletedRef.current = true;
              setOpen(false);
              void queryClient.invalidateQueries(
                trpc.announcement.list.pathFilter(),
              );
            }}
          >
            {isPending ? 'Deleting…' : 'Delete announcement'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
