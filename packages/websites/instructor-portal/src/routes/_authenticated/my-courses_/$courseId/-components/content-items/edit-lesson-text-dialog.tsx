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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { useDiscardGuard } from '@discava/common-shadcn/hooks/use-discard-guard';
import { focusFirstInvalid } from '@discava/common-shadcn/lib/focus-first-invalid';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { RichTextEditor } from '../rich-text-editor';
import { studentActivityNote } from '../student-activity';

export function EditLessonTextDialog({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  description,
  body,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  /** Set when editing an existing text item; omitted when adding a new one. */
  contentItemId?: string;
  title?: string;
  description?: string;
  body?: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [titleValue, setTitleValue] = useState(title ?? '');
  const [descriptionValue, setDescriptionValue] = useState(description ?? '');
  const [bodyValue, setBodyValue] = useState(body);
  const [saveError, setSaveError] = useState<string>();
  // What is wrong with the fields, shown beside them once Save is pressed.
  const [problems, setProblems] = useState<{ title?: string; body?: string }>(
    {},
  );
  const fieldsRef = useRef<HTMLDivElement>(null);
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();

  const { mutateAsync: createLessonContentItem, isPending: isCreating } =
    useMutation(contentItem.createText.mutationOptions());
  const { mutateAsync: updateLessonContentItem, isPending: isUpdating } =
    useMutation(contentItem.updateText.mutationOptions());
  const isSaving = isCreating || isUpdating;

  const handleSave = async () => {
    setSaveError(undefined);
    const found = {
      title: titleValue.trim() ? undefined : 'Enter a title.',
      body: bodyValue ? undefined : 'Write the text students will read.',
    };
    setProblems(found);
    if (found.title || found.body || !bodyValue) {
      focusFirstInvalid(fieldsRef.current);
      return;
    }
    try {
      if (contentItemId) {
        await updateLessonContentItem({
          courseId,
          moduleId,
          lessonId,
          contentItemId,
          title: titleValue.trim(),
          description: descriptionValue || undefined,
          body: bodyValue,
        });
      } else {
        await createLessonContentItem({
          courseId,
          moduleId,
          lessonId,
          title: titleValue.trim(),
          description: descriptionValue || undefined,
          body: bodyValue,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
      setOpen(false);
    } catch (error) {
      setSaveError(apiErrorMessage(error, "Couldn't save the text"));
    }
  };

  const dirty =
    titleValue !== (title ?? '') ||
    descriptionValue !== (description ?? '') ||
    bodyValue !== body;
  // Starts from what is saved, so each open begins fresh.
  const reset = () => {
    setTitleValue(title ?? '');
    setDescriptionValue(description ?? '');
    setBodyValue(body);
    setSaveError(undefined);
    setProblems({});
  };
  const close = () => {
    setOpen(false);
    reset();
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
          reset();
          setOpen(true);
        } else {
          requestClose();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl" {...contentProps}>
        <DialogHeader>
          <DialogTitle>{contentItemId ? 'Edit text' : 'Add text'}</DialogTitle>
          <DialogDescription>
            Write a rich text block for students to read in this lesson.
          </DialogDescription>
        </DialogHeader>

        {saveError && (
          <ErrorAlert type="error" header="Couldn't save the text">
            {saveError}
          </ErrorAlert>
        )}

        <div ref={fieldsRef} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lesson-text-title">Title</Label>
            <Input
              id="lesson-text-title"
              value={titleValue}
              onChange={(event) => {
                setTitleValue(event.target.value);
                setProblems((current) => ({ ...current, title: undefined }));
              }}
              placeholder="e.g. Key concepts"
              autoFocus
              aria-invalid={Boolean(problems.title)}
              aria-describedby={
                problems.title ? 'lesson-text-title-error' : undefined
              }
            />
            {problems.title && (
              <p
                id="lesson-text-title-error"
                className="text-sm text-destructive"
              >
                {problems.title}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lesson-text-description">Description</Label>
            <Textarea
              id="lesson-text-description"
              value={descriptionValue}
              onChange={(event) => setDescriptionValue(event.target.value)}
              placeholder="Optional notes for students"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">Body</span>
            <RichTextEditor
              value={bodyValue}
              onChange={(next) => {
                setBodyValue(next);
                setProblems((current) => ({ ...current, body: undefined }));
              }}
              ariaLabel="Body"
              invalid={Boolean(problems.body)}
              describedBy={problems.body ? 'lesson-text-body-error' : undefined}
            />
            {problems.body && (
              <p
                id="lesson-text-body-error"
                className="text-sm text-destructive"
              >
                {problems.body}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <PendingButton
            type="button"
            pending={isSaving}
            pendingLabel="Saving…"
            onClick={handleSave}
          >
            Save
          </PendingButton>
        </DialogFooter>
        {confirmation}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirms before removing a text item from a lesson, same treatment as
 * RemoveLessonVideoButton gives videos.
 */
export function RemoveLessonTextButton({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  archive,
  students = 0,
  noun = 'text',
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  title: string;
  // Outside a draft course, removing archives the text instead: students
  // stop seeing it, but it and their data for it are kept and restorable.
  archive: boolean;
  // How many students have used it, for the warning on archiving.
  students?: number;
  // What it's called in the dialog: 'text' by default, or 'quiz'.
  noun?: string;
}) {
  const [open, setOpen] = useState(false);
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: removeContentItem,
    reset: resetRemoveContentItem,
    isPending,
    isError,
    error,
  } = useMutation(contentItem.delete.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetRemoveContentItem();
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={`Remove ${title}`}
          className="-ml-2 transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {archive ? `Archive ${noun}` : `Remove ${noun}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {archive
              ? `Students will no longer see "${title}". Their progress is kept, and the ${noun} can be restored.`
              : `Are you sure you want to remove "${title}"? This can't be undone.`}
          </AlertDialogDescription>
          {archive && studentActivityNote({ students }) && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {studentActivityNote({ students })}. Their progress is kept, and
              counts again if it's restored.
            </p>
          )}
        </AlertDialogHeader>

        {isError && (
          <ErrorAlert
            type="error"
            header={
              archive
                ? `Couldn't archive the ${noun}`
                : `Couldn't remove the ${noun}`
            }
          >
            {apiErrorMessage(error)}
          </ErrorAlert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={archive ? 'default' : 'destructive'}
            disabled={isPending}
            onClick={async () => {
              try {
                await removeContentItem({
                  courseId,
                  moduleId,
                  lessonId,
                  contentItemId,
                });
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
            {archive
              ? isPending
                ? 'Archiving…'
                : `Archive ${noun}`
              : isPending
                ? 'Removing…'
                : `Remove ${noun}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
