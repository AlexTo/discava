/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { useDiscardGuard } from '@discava/common-shadcn/hooks/use-discard-guard';
import { useUnsavedChangesGuard } from '@discava/common-shadcn/hooks/use-unsaved-changes-guard';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useInstructorApi } from '../../../../../../../api';
import { VideoQuestionsEditor } from './video-questions-editor';
import type { VideoItem } from './video-questions-form';

// The video questions editor in a dialog. Closing with unsaved changes asks
// first.
export function VideoQuestionsDialog({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  title: string;
  trigger: ReactNode;
}) {
  const { course, contentItem } = useInstructorApi();
  const [open, setOpen] = useState(false);
  // The course page has it cached already; only read while open.
  const courseQuery = useQuery({
    ...course.view.queryOptions({ courseId }),
    enabled: open,
  });
  const videoUrlQuery = useQuery({
    ...contentItem.createVideoUrl.queryOptions({
      courseId,
      moduleId,
      lessonId,
      contentItemId,
    }),
    enabled: open,
  });
  // Bumped to start the editor again: on each open, and on reload after a
  // CONFLICT.
  const [session, setSession] = useState(0);
  const [dirty, setDirty] = useState(false);

  const view = courseQuery.data;
  const module = view?.modules.find((m) => m.moduleId === moduleId);
  const lesson = module?.lessons.find((l) => l.lessonId === lessonId);
  const item = lesson?.contentItems.find(
    (candidate) => candidate.contentItemId === contentItemId,
  );
  // course.view's content item type is a union keyed on `type`.
  const video =
    item?.type === 'video' ? (item as unknown as VideoItem) : undefined;
  const durationSeconds =
    item?.type === 'video' ? item.durationSeconds : undefined;

  // An archived course, module, lesson or video is frozen until restored.
  const readOnlyReason =
    view?.status === 'archived'
      ? 'The course is archived. Restore the course to edit its questions.'
      : module?.archivedAt
        ? `Its module, "${module.title}", is archived. Restore the module first.`
        : lesson?.archivedAt
          ? `Its lesson, "${lesson.title}", is archived. Restore the lesson first.`
          : item?.archivedAt
            ? 'This video is archived. Restore it from the course page to edit its questions.'
            : undefined;

  const close = () => {
    setDirty(false);
    setOpen(false);
  };
  const { contentProps, requestClose, confirmation } = useDiscardGuard({
    dirty,
    discard: close,
  });
  const unsavedChanges = useUnsavedChangesGuard(dirty);

  const loading = courseQuery.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setSession((count) => count + 1);
          setOpen(true);
        } else {
          requestClose();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        {...contentProps}
        className="max-h-[90vh] overflow-y-auto pb-0 sm:max-w-5xl"
      >
        <DialogHeader>
          <DialogTitle>Questions</DialogTitle>
          <DialogDescription>
            {module && lesson
              ? `${title}, in ${module.title} › ${lesson.title}`
              : `Questions learners answer while watching ${title}.`}
          </DialogDescription>
        </DialogHeader>
        {!video ? (
          loading ? (
            <div className="flex justify-center pb-10 pt-4">
              <Spinner />
            </div>
          ) : (
            <p className="pb-6 text-sm text-muted-foreground">
              This video doesn't exist any more.
            </p>
          )
        ) : (
          <VideoQuestionsEditor
            key={session}
            courseId={courseId}
            moduleId={moduleId}
            lessonId={lessonId}
            contentItemId={contentItemId}
            video={video}
            player={videoUrlQuery.data}
            durationSeconds={durationSeconds}
            studentActivityCount={item?.studentActivityCount ?? 0}
            readOnlyReason={readOnlyReason}
            onDirtyChange={setDirty}
            onClose={requestClose}
            onReload={async () => {
              await courseQuery.refetch();
              setSession((count) => count + 1);
            }}
          />
        )}

        {confirmation}
        {unsavedChanges.confirmation}
      </DialogContent>
    </Dialog>
  );
}
