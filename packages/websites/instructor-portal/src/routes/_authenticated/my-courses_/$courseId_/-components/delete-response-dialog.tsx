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
import { useInstructorApi } from '../../../../../api';

export const respondButtonId = (reviewerId: string) => `respond-${reviewerId}`;

export function DeleteResponseDialog({
  courseId,
  reviewerId,
  trigger,
  onDeleted,
}: {
  courseId: string;
  reviewerId: string;
  trigger: ReactNode;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const remove = useMutation(trpc.review.deleteResponse.mutationOptions());
  const deleted = useRef(false);

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
      <AlertDialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          // This trigger goes with the response; the row's Respond button
          // takes its place.
          if (deleted.current) {
            deleted.current = false;
            event.preventDefault();
            document.getElementById(respondButtonId(reviewerId))?.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete response</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your response from the review. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {remove.isError && (
          <ErrorAlert type="error" header="Couldn't delete the response">
            {apiErrorMessage(remove.error)}
          </ErrorAlert>
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
              deleted.current = true;
              setOpen(false);
              onDeleted?.();
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
