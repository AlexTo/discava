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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Spinner } from '../../../../../../../components/spinner';
import { useInstructorApi } from '../../../../../../../hooks/useInstructorApi';
import { QuizBuilder } from './quiz-builder';
import type { QuizItem } from './quiz-form';

// The quiz builder in a dialog, for a new quiz (no contentItemId) or an
// existing one. Closing with unsaved changes asks first.
export function QuizBuilderDialog({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId?: string;
  trigger: ReactNode;
}) {
  const { course } = useInstructorApi();
  const [open, setOpen] = useState(false);
  // The course page has it cached already; only read while open.
  const courseQuery = useQuery({
    ...course.view.queryOptions({ courseId }),
    enabled: open,
  });
  // Bumped to start the builder again: on each open, and on reload after a
  // CONFLICT.
  const [session, setSession] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A new quiz's id, once its first save has created it.
  const [createdId, setCreatedId] = useState<string>();
  const quizId = contentItemId ?? createdId;

  const view = courseQuery.data;
  const module = view?.modules.find((m) => m.moduleId === moduleId);
  const lesson = module?.lessons.find((l) => l.lessonId === lessonId);
  const item = lesson?.contentItems.find(
    (candidate) => candidate.contentItemId === quizId,
  );
  // course.view's content item type is a union keyed on `type`.
  const quiz =
    item?.type === 'quiz' ? (item as unknown as QuizItem) : undefined;

  // An archived course, module, lesson or quiz is frozen until restored.
  const readOnlyReason =
    view?.status === 'archived'
      ? 'The course is archived. Restore the course to edit its quizzes.'
      : module?.archivedAt
        ? `Its module, "${module.title}", is archived. Restore the module first.`
        : lesson?.archivedAt
          ? `Its lesson, "${lesson.title}", is archived. Restore the lesson first.`
          : item?.archivedAt
            ? 'This quiz is archived. Restore it from the course page to edit it.'
            : undefined;

  // Closing with unsaved changes asks first.
  const requestClose = () => {
    if (dirty) {
      setConfirmDiscard(true);
    } else {
      close();
    }
  };

  const close = () => {
    setConfirmDiscard(false);
    setDirty(false);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setCreatedId(undefined);
          setSession((count) => count + 1);
          setOpen(true);
        } else {
          requestClose();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* Closed from the footer's Close, which stays in view while the
          dialog scrolls, or Escape. */}
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] overflow-y-auto pb-0 sm:max-w-5xl"
      >
        <DialogHeader>
          <DialogTitle>
            {contentItemId ? `Edit ${quiz?.title ?? 'quiz'}` : 'New quiz'}
          </DialogTitle>
          <DialogDescription>
            {module && lesson
              ? `In ${module.title} › ${lesson.title}`
              : 'Questions students answer in this lesson.'}
          </DialogDescription>
        </DialogHeader>
        {/* A quiz opened to edit needs its data first; a new one just created
            keeps its builder while course.view catches up. */}
        {contentItemId && !quiz ? (
          courseQuery.isPending ? (
            <div className="flex justify-center pb-10 pt-4">
              <Spinner />
            </div>
          ) : (
            <p className="pb-6 text-sm text-muted-foreground">
              This quiz doesn't exist any more.
            </p>
          )
        ) : (
          <QuizBuilder
            key={session}
            courseId={courseId}
            moduleId={moduleId}
            lessonId={lessonId}
            contentItemId={quizId}
            quiz={quiz}
            studentActivityCount={item?.studentActivityCount ?? 0}
            readOnlyReason={readOnlyReason}
            onDirtyChange={setDirty}
            onClose={requestClose}
            onCreated={setCreatedId}
            onReload={async () => {
              await courseQuery.refetch();
              setSession((count) => count + 1);
            }}
          />
        )}

        <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
              <AlertDialogDescription>
                The changes you made since the last save will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={close}>
                Discard changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
