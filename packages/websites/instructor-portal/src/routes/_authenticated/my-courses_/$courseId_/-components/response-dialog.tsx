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
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { useDiscardGuard } from '@discava/common-shadcn/hooks/use-discard-guard';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useInstructorApi } from '../../../../../api';

export const RESPONSE_MAX = 1000;

/**
 * The dialog to answer a review, or with `existing` to change the answer. A
 * failed save keeps the dialog open with what was typed.
 */
export function ResponseDialog({
  courseId,
  reviewerId,
  reviewerName,
  existing,
  trigger,
}: {
  courseId: string;
  reviewerId: string;
  reviewerName: string;
  /** The current response text, when editing. */
  existing?: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(existing ?? '');
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const respond = useMutation(trpc.review.respond.mutationOptions());
  const textId = `response-${reviewerId}`;

  const save = async () => {
    if (respond.isPending) {
      return;
    }
    try {
      await respond.mutateAsync({ courseId, reviewerId, text: text.trim() });
    } catch {
      // Shown in the dialog.
      return;
    }
    setOpen(false);
    void queryClient.invalidateQueries(trpc.review.list.pathFilter());
  };

  const dirty = text !== (existing ?? '');
  const close = () => {
    setOpen(false);
    setText(existing ?? '');
    respond.reset();
  };
  const { contentProps, requestClose, confirmation } = useDiscardGuard({
    dirty,
    discard: close,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setText(existing ?? '');
          setOpen(true);
        } else {
          requestClose();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg" {...contentProps}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {existing === undefined ? 'Respond to review' : 'Edit response'}
            </DialogTitle>
            <DialogDescription>
              {`Your response appears under ${reviewerName}'s review for everyone to read.`}
            </DialogDescription>
          </DialogHeader>

          {respond.isError && (
            <ErrorAlert type="error" header="Couldn't save the response">
              {apiErrorMessage(respond.error)}
            </ErrorAlert>
          )}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={textId}>Response</Label>
              <span
                id={`${textId}-count`}
                className="text-xs text-muted-foreground"
              >{`${text.length}/${RESPONSE_MAX}`}</span>
            </div>
            <Textarea
              id={textId}
              aria-describedby={`${textId}-count`}
              value={text}
              maxLength={RESPONSE_MAX}
              rows={5}
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={text.trim() === '' || respond.isPending}
            >
              {respond.isPending ? 'Saving…' : 'Save response'}
            </Button>
          </DialogFooter>
        </form>
        {confirmation}
      </DialogContent>
    </Dialog>
  );
}
