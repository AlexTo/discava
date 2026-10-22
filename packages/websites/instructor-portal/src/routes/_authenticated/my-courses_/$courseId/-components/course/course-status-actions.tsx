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
import { RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';

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
          <Alert type="error" header="Couldn't publish the course">
            {apiErrorMessage(error)}
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            disabled={isPending}
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
            {isPending ? 'Publishing...' : 'Publish'}
          </Button>
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
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
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
        <RotateCcw /> {isPending ? 'Restoring...' : 'Restore'}
      </Button>
      {isError && (
        <Alert type="error" header="Couldn't restore the course">
          {apiErrorMessage(error)}
        </Alert>
      )}
    </div>
  );
}
