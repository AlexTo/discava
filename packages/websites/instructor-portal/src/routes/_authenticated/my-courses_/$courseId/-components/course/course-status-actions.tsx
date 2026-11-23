/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
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
import { RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

// Publish for a draft course, Restore for an archived one. A published course
// has neither.
export function CourseStatusActions({
  courseId,
  title,
  status,
}: {
  courseId: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
}) {
  if (status === 'draft') {
    return <PublishCourseDialog courseId={courseId} title={title} />;
  }
  if (status === 'archived') {
    return <RestoreCourseButton courseId={courseId} />;
  }
  return null;
}

function PublishCourseDialog({
  courseId,
  title,
}: {
  courseId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: publishCourse,
    reset: resetPublishCourse,
    isPending,
    isError,
    error,
  } = useMutation(course.publish.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetPublishCourse();
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button">
          <Send /> Publish
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Publish course</AlertDialogTitle>
          <AlertDialogDescription>
            Students will be able to see "{title}" and everything in it. After
            this, removing a module, lesson or content item archives it instead
            of deleting it, and new content stays hidden until you publish it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isError && (
          <ErrorAlert type="error" header="Couldn't publish the course">
            {apiErrorMessage(error)}
          </ErrorAlert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <PendingButton
            type="button"
            pending={isPending}
            pendingLabel="Publishing…"
            onClick={async () => {
              try {
                await publishCourse({ courseId });
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
            Publish
          </PendingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RestoreCourseButton({ courseId }: { courseId: string }) {
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: restoreCourse,
    isPending,
    isError,
    error,
  } = useMutation(course.restore.mutationOptions());

  return (
    <div className="space-y-2">
      <PendingButton
        type="button"
        variant="outline"
        pending={isPending}
        pendingLabel="Restoring…"
        onClick={async () => {
          try {
            await restoreCourse({ courseId });
          } catch {
            // Surfaced via the error below.
            return;
          }
          void queryClient.invalidateQueries({
            queryKey: course.view.queryKey({ courseId }),
          });
        }}
      >
        <RotateCcw /> Restore
      </PendingButton>
      {isError && (
        <ErrorAlert type="error" header="Couldn't restore the course">
          {apiErrorMessage(error)}
        </ErrorAlert>
      )}
    </div>
  );
}
