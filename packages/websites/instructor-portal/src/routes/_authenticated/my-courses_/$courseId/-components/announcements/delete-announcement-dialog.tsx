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

export function DeleteAnnouncementDialog({
  courseId,
  announcementId,
  title,
  trigger,
}: {
  courseId: string;
  announcementId: string;
  title: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete announcement</AlertDialogTitle>
          <AlertDialogDescription>
            {`Are you sure you want to delete "${title}"? This can't be undone. Students keep the notification they already received.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isError && (
          <Alert type="error" header="Couldn't delete the announcement">
            {apiErrorMessage(error)}
          </Alert>
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
