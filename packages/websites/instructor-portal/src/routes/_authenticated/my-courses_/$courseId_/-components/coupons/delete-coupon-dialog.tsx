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
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useInstructorApi } from '../../../../../../api';

/** Confirms deleting a code nobody has used. */
export function DeleteCouponDialog({
  courseId,
  code,
  open,
  onOpenChange,
  onDeleted,
}: {
  courseId: string;
  code: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const remove = useMutation(trpc.coupon.delete.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          remove.reset();
        }
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{`Delete ${code}`}</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the code. No one has used it. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {remove.isError && (
          <ErrorAlert type="error" header="Couldn't delete the code">
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
                await remove.mutateAsync({ courseId, code });
              } catch {
                // Shown above.
                return;
              }
              onOpenChange(false);
              onDeleted();
              void queryClient.invalidateQueries(trpc.coupon.list.pathFilter());
            }}
          >
            {remove.isPending ? 'Deleting…' : 'Delete code'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
