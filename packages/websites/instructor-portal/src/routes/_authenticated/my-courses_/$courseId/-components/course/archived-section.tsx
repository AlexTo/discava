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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { studentActivityNote, usedItemCount } from '../student-activity';

type ArchivedItem = {
  contentItemId: string;
  type: string;
  title: string;
  archivedAt?: string;
  studentActivityCount: number;
};
type ArchivedLesson = {
  lessonId: string;
  title: string;
  archivedAt?: string;
  contentItems: ArchivedItem[];
};
type ArchivedModule = {
  moduleId: string;
  title: string;
  archivedAt?: string;
  lessons: ArchivedLesson[];
};

type Entry = {
  key: string;
  kind: 'module' | 'lesson' | 'item';
  // What the row calls the record: "module", "lesson", or the item's type.
  noun: string;
  title: string;
  // Where it was, for a lesson or item: "Module One" or "Module One › Lesson One".
  location?: string;
  archivedAt: string;
  // What comes back with it, for a module or lesson: "2 lessons, 5 items".
  contents?: string;
  // Students who have used the item, or for a module or lesson the number of
  // its items students have used. Anything with student activity can be
  // restored but never deleted permanently.
  activity: { students?: number; items?: number };
  ids: { moduleId: string; lessonId?: string; contentItemId?: string };
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

// The records to list: only ones archived in their own right. A lesson or item
// under an archived module (or an item under an archived lesson) comes back
// with its parent, so it isn't listed separately. Most recently archived first.
export const archivedEntries = (modules: ArchivedModule[]): Entry[] => {
  const entries: Entry[] = [];
  for (const module of modules) {
    if (module.archivedAt) {
      const items = module.lessons.flatMap(({ contentItems }) => contentItems);
      entries.push({
        key: `module:${module.moduleId}`,
        kind: 'module',
        noun: 'module',
        title: module.title,
        archivedAt: module.archivedAt,
        contents: `${plural(module.lessons.length, 'lesson')}, ${plural(items.length, 'item')}`,
        activity: { items: usedItemCount(items) },
        ids: { moduleId: module.moduleId },
      });
      continue;
    }
    for (const lesson of module.lessons) {
      if (lesson.archivedAt) {
        entries.push({
          key: `lesson:${lesson.lessonId}`,
          kind: 'lesson',
          noun: 'lesson',
          title: lesson.title,
          location: module.title,
          archivedAt: lesson.archivedAt,
          contents: plural(lesson.contentItems.length, 'item'),
          activity: { items: usedItemCount(lesson.contentItems) },
          ids: { moduleId: module.moduleId, lessonId: lesson.lessonId },
        });
        continue;
      }
      for (const item of lesson.contentItems) {
        if (item.archivedAt) {
          entries.push({
            key: `item:${item.contentItemId}`,
            kind: 'item',
            noun: item.type,
            title: item.title,
            location: `${module.title} › ${lesson.title}`,
            archivedAt: item.archivedAt,
            activity: { students: item.studentActivityCount },
            ids: {
              moduleId: module.moduleId,
              lessonId: lesson.lessonId,
              contentItemId: item.contentItemId,
            },
          });
        }
      }
    }
  }
  return entries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
};

// The archived records of a course, with Restore and Delete permanently. In an
// archived course nothing can be restored until the course is, but archived
// records can still be deleted permanently.
export function ArchivedSection({
  courseId,
  modules,
  readOnly,
}: {
  courseId: string;
  modules: ArchivedModule[];
  // The course itself is archived: it's read-only until restored.
  readOnly: boolean;
}) {
  const entries = archivedEntries(modules);
  if (entries.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="archived-heading" className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <Archive className="size-5 text-muted-foreground" />
          <h2 id="archived-heading" className="text-xl font-semibold">
            Archived
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {readOnly
            ? 'Restore the course to restore these. Anything students haven’t used can still be deleted permanently.'
            : 'Students can’t see these. Restore one to bring it back, with everything in it, at the end of where it was.'}
        </p>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {entries.map((entry) => (
          <ArchivedRow
            key={entry.key}
            courseId={courseId}
            entry={entry}
            readOnly={readOnly}
          />
        ))}
      </ul>
    </section>
  );
}

// Restore and permanent delete for one record, typed per kind.
const useArchivedActions = (courseId: string, entry: Entry) => {
  const { course, module, lesson, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const restoreModule = useMutation(module.restore.mutationOptions());
  const restoreLesson = useMutation(lesson.restore.mutationOptions());
  const restoreItem = useMutation(contentItem.restore.mutationOptions());
  const deleteModule = useMutation(module.deletePermanently.mutationOptions());
  const deleteLesson = useMutation(lesson.deletePermanently.mutationOptions());
  const deleteItem = useMutation(
    contentItem.deletePermanently.mutationOptions(),
  );
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
  const { moduleId, lessonId = '', contentItemId = '' } = entry.ids;

  const [restore, remove] = {
    module: [restoreModule, deleteModule] as const,
    lesson: [restoreLesson, deleteLesson] as const,
    item: [restoreItem, deleteItem] as const,
  }[entry.kind];
  const run = async (action: 'restore' | 'delete') => {
    const input = { courseId, moduleId, lessonId, contentItemId };
    if (entry.kind === 'module') {
      await (action === 'restore' ? restoreModule : deleteModule).mutateAsync({
        courseId,
        moduleId,
      });
    } else if (entry.kind === 'lesson') {
      await (action === 'restore' ? restoreLesson : deleteLesson).mutateAsync({
        courseId,
        moduleId,
        lessonId,
      });
    } else {
      await (action === 'restore' ? restoreItem : deleteItem).mutateAsync(
        input,
      );
    }
    await refresh();
  };
  return { restore, remove, run };
};

function ArchivedRow({
  courseId,
  entry,
  readOnly,
}: {
  courseId: string;
  entry: Entry;
  readOnly: boolean;
}) {
  const { restore, remove, run } = useArchivedActions(courseId, entry);
  const note = studentActivityNote(entry.activity);
  const used = Boolean(entry.activity.students || entry.activity.items);

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {entry.title}{' '}
            <span className="font-normal text-muted-foreground">
              ({entry.noun})
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {[
              entry.location && `in ${entry.location}`,
              `archived ${new Date(entry.archivedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
              entry.contents,
              note,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={restore.isPending}
            aria-label={`Restore ${entry.noun} ${entry.title}`}
            onClick={() => {
              remove.reset();
              void run('restore').catch(() => {
                // Shown below the row.
              });
            }}
          >
            <RotateCcw /> {restore.isPending ? 'Restoring...' : 'Restore'}
          </Button>
        )}
        <DeletePermanentlyDialog
          entry={entry}
          used={used}
          onConfirm={() => run('delete')}
          isPending={remove.isPending}
          isError={remove.isError}
          errorMessage={remove.error?.message}
          reset={remove.reset}
        />
      </div>
      {restore.isError && (
        <Alert type="error" header={`Couldn't restore the ${entry.noun}`}>
          {restore.error.message}
        </Alert>
      )}
    </li>
  );
}

function DeletePermanentlyDialog({
  entry,
  used,
  onConfirm,
  isPending,
  isError,
  errorMessage,
  reset,
}: {
  entry: Entry;
  // Students have used it (or something in it): the API refuses to delete it.
  used: boolean;
  onConfirm: () => Promise<unknown>;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  reset: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (used) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        title="Students have used it, so it can stay archived but can't be deleted permanently"
        aria-label={`Delete ${entry.noun} ${entry.title} permanently (not possible: students have used it)`}
      >
        <Trash2 /> Delete permanently
      </Button>
    );
  }

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
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Delete ${entry.noun} ${entry.title} permanently`}
        >
          <Trash2 /> Delete permanently
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {entry.noun} permanently</AlertDialogTitle>
          <AlertDialogDescription>
            "{entry.title}"
            {entry.kind === 'item' ? '' : ' and everything in it'} will be
            deleted for good
            {entry.kind === 'item' ? '' : ` (${entry.contents})`}. This can't be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isError && (
          <Alert type="error" header={`Couldn't delete the ${entry.noun}`}>
            {errorMessage}
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
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
            {isPending ? 'Deleting...' : 'Delete permanently'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
