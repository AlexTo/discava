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
import { cn } from '@discava/common-shadcn/lib/utils';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../../../../components/alert';
import { useInstructorApi } from '../../../../../hooks/useInstructorApi';

type Visibility = 'hidden' | 'visible';

type Level = 'module' | 'lesson' | 'item';

// What publishing or hiding a record means to students. Students only see a
// record while it and everything above it is visible, so it depends on where
// the record sits, and on whether the course is open to students yet.
const describe = ({
  level,
  title,
  visibility,
  draft,
}: {
  level: Level;
  title: string;
  visibility: Visibility;
  draft: boolean;
}) => {
  const hasChildren = level !== 'item';
  if (visibility === 'hidden') {
    const when = draft
      ? 'once the course is published'
      : {
          module: 'straight away',
          lesson: 'as long as its module is visible',
          item: 'as long as its lesson and module are visible',
        }[level];
    return hasChildren
      ? `Students will see "${title}" ${when}, together with the new content in it that hasn't been published yet. Anything you hid after students could see it stays hidden.`
      : `Students will see "${title}" ${when}.`;
  }
  return draft
    ? `"${title}"${hasChildren ? ' and everything in it' : ''} will stay hidden from students when the course is published, until you publish it again.`
    : `Students will no longer see "${title}"${hasChildren ? ' or anything in it' : ''}. Their progress is kept, and you can publish it again.`;
};

// The confirmation shared by every Publish/Hide button: the action itself is
// passed in, typed per record kind by the wrappers below.
function VisibilityDialog({
  noun,
  level,
  title,
  visibility,
  draft,
  className,
  onConfirm,
  isPending,
  isError,
  errorMessage,
  reset,
}: {
  noun: string;
  level: Level;
  title: string;
  visibility: Visibility;
  draft: boolean;
  className?: string;
  onConfirm: () => Promise<unknown>;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  reset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const publish = visibility === 'hidden';
  const action = publish ? 'Publish' : 'Hide';

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
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={`${action} ${noun} ${title}`}
          title={`${action} ${noun}`}
          className={cn(className)}
        >
          {publish ? <Eye /> : <EyeOff />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action} {noun}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {describe({ level, title, visibility, draft })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isError && (
          <Alert
            type="error"
            header={`Couldn't ${action.toLowerCase()} the ${noun}`}
          >
            {errorMessage}
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            disabled={isPending}
            onClick={async () => {
              try {
                await onConfirm();
              } catch {
                // Surfaced via the error above; keep the dialog open.
                return;
              }
              setOpen(false);
            }}
          >
            {isPending
              ? publish
                ? 'Publishing...'
                : 'Hiding...'
              : `${action} ${noun}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Refreshes the course view once a publish or hide lands, so badges and
// buttons reflect what was written.
const useRefreshCourse = (courseId: string) => {
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
};

export function ModuleVisibilityButton({
  courseId,
  moduleId,
  title,
  visibility,
  draft,
  className,
}: {
  courseId: string;
  moduleId: string;
  title: string;
  visibility: Visibility;
  // A draft course isn't open to students yet, which changes what the action
  // means to them.
  draft: boolean;
  className?: string;
}) {
  const { module } = useInstructorApi();
  const refresh = useRefreshCourse(courseId);
  const mutation = useMutation(
    (visibility === 'hidden' ? module.publish : module.hide).mutationOptions(),
  );
  return (
    <VisibilityDialog
      noun="module"
      level="module"
      title={title}
      visibility={visibility}
      draft={draft}
      className={className}
      onConfirm={async () => {
        await mutation.mutateAsync({ courseId, moduleId });
        await refresh();
      }}
      isPending={mutation.isPending}
      isError={mutation.isError}
      errorMessage={
        mutation.error ? apiErrorMessage(mutation.error) : undefined
      }
      reset={mutation.reset}
    />
  );
}

export function LessonVisibilityButton({
  courseId,
  moduleId,
  lessonId,
  title,
  visibility,
  draft,
  className,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  title: string;
  visibility: Visibility;
  draft: boolean;
  className?: string;
}) {
  const { lesson } = useInstructorApi();
  const refresh = useRefreshCourse(courseId);
  const mutation = useMutation(
    (visibility === 'hidden' ? lesson.publish : lesson.hide).mutationOptions(),
  );
  return (
    <VisibilityDialog
      noun="lesson"
      level="lesson"
      title={title}
      visibility={visibility}
      draft={draft}
      className={className}
      onConfirm={async () => {
        await mutation.mutateAsync({ courseId, moduleId, lessonId });
        await refresh();
      }}
      isPending={mutation.isPending}
      isError={mutation.isError}
      errorMessage={
        mutation.error ? apiErrorMessage(mutation.error) : undefined
      }
      reset={mutation.reset}
    />
  );
}

export function ContentItemVisibilityButton({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  noun,
  title,
  visibility,
  draft,
  className,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  // What the item is, for the button's label and the dialog: "video", "text".
  noun: string;
  title: string;
  visibility: Visibility;
  draft: boolean;
  className?: string;
}) {
  const { contentItem } = useInstructorApi();
  const refresh = useRefreshCourse(courseId);
  const mutation = useMutation(
    (visibility === 'hidden'
      ? contentItem.publish
      : contentItem.hide
    ).mutationOptions(),
  );
  return (
    <VisibilityDialog
      noun={noun}
      level="item"
      title={title}
      visibility={visibility}
      draft={draft}
      className={className}
      onConfirm={async () => {
        await mutation.mutateAsync({
          courseId,
          moduleId,
          lessonId,
          contentItemId,
        });
        await refresh();
      }}
      isPending={mutation.isPending}
      isError={mutation.isError}
      errorMessage={
        mutation.error ? apiErrorMessage(mutation.error) : undefined
      }
      reset={mutation.reset}
    />
  );
}
