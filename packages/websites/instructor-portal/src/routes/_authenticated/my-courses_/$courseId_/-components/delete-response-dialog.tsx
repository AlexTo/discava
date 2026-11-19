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
import { Alert } from '../../../../../components/alert';
import { useInstructorApi } from '../../../../../hooks/useInstructorApi';

export function DeleteResponseDialog({
  courseId,
  reviewerId,
  trigger,
}: {
  courseId: string;
  reviewerId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const remove = useMutation(trpc.review.deleteResponse.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          remove.reset();
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete response</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your response from the review. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {remove.isError && (
          <Alert type="error" header="Couldn't delete the response">
            {apiErrorMessage(remove.error)}
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={async () => {
              try {
                await remove.mutateAsync({ courseId, reviewerId });
              } catch {
                // Shown above.
                return;
              }
              setOpen(false);
              void queryClient.invalidateQueries(trpc.review.list.pathFilter());
            }}
          >
            {remove.isPending ? 'Deleting…' : 'Delete response'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
