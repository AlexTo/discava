/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCoreApi, useInstructorApi } from '../../../../../../api';
import type { LessonRef } from './lessons';

export interface PostRef extends LessonRef {
  threadId: string;
  postId: string;
}

interface PostAction {
  mutate: (ref: PostRef) => void;
}

// Spelled out so the declaration emit doesn't have to name the API router's
// inferred types.
export interface Moderation {
  hide: PostAction;
  unhide: PostAction;
  remove: PostAction;
  dismissReports: PostAction;
  busy: boolean;
}

// Hide, unhide, delete and dismiss reports. Whatever changes refreshes the
// queues and the open threads and lists, which are core-api's.
export function useModeration(onError: (error: unknown) => void): Moderation {
  const instructorApi = useInstructorApi();
  const coreApi = useCoreApi();
  const queryClient = useQueryClient();
  const settings = {
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: instructorApi.discussion.pathKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: coreApi.discussion.pathKey(),
        }),
      ]),
    onError,
  };
  const hide = useMutation(
    instructorApi.discussion.hide.mutationOptions(settings),
  );
  const unhide = useMutation(
    instructorApi.discussion.unhide.mutationOptions(settings),
  );
  const remove = useMutation(
    instructorApi.discussion.remove.mutationOptions(settings),
  );
  const dismissReports = useMutation(
    instructorApi.discussion.dismissReports.mutationOptions(settings),
  );
  return {
    hide,
    unhide,
    remove,
    dismissReports,
    busy:
      hide.isPending ||
      unhide.isPending ||
      remove.isPending ||
      dismissReports.isPending,
  };
}

// "Delete" with a confirmation naming what is deleted.
export function DeletePostButton({
  kind,
  disabled,
  onConfirm,
}: {
  kind: 'question' | 'reply';
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {kind}?</AlertDialogTitle>
            <AlertDialogDescription>
              {kind === 'question'
                ? 'The question is deleted for everyone, and so is its accepted answer. This cannot be undone.'
                : 'The reply is deleted for everyone. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>
              Delete {kind}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
