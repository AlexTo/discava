/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { DiscardChangesDialog } from '@discava/common-shadcn/components/discard-changes-dialog';
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
import { useDiscardGuard } from '@discava/common-shadcn/hooks/use-discard-guard';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { QuizBuilder } from '../content-items/quiz/quiz-builder';
import {
  dueAtToIso,
  type UploadAssignmentValues,
  validateUploadAssignment,
} from './assignment-form';
import { UploadAssignmentFields } from './upload-assignment-fields';

type Kind = 'upload' | 'quiz';

const EMPTY: UploadAssignmentValues = {
  title: '',
  body: undefined,
  maxPoints: '10',
  dueAt: '',
};

const KINDS: { kind: Kind; label: string; hint: string }[] = [
  {
    kind: 'upload',
    label: 'Upload',
    hint: 'Students submit files, and you grade them.',
  },
  {
    kind: 'quiz',
    label: 'Quiz',
    hint: 'Students answer questions, graded automatically.',
  },
];

// Adds an assignment to a module: a lesson of its own holding one upload
// assignment or quiz. Picks the kind first, then takes that kind's fields.
export function CreateAssignmentDialog({
  courseId,
  moduleId,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('upload');
  const [values, setValues] = useState(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  // Whether the quiz builder holds unsaved changes.
  const [quizDirty, setQuizDirty] = useState(false);
  // The kind asked for while a dirty quiz is open, until the instructor says.
  const [switchTo, setSwitchTo] = useState<Kind>();
  // Bumped on each open, so the quiz builder starts empty again.
  const [session, setSession] = useState(0);
  const { course, lesson } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: createUpload,
    reset: resetCreateUpload,
    isPending,
    isError,
    error,
  } = useMutation(lesson.createUploadAssignment.mutationOptions());

  const errors = validateUploadAssignment(values);
  const hasErrors = Object.keys(errors).length > 0;

  const refreshCourse = () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });

  const close = () => {
    setOpen(false);
    resetCreateUpload();
  };
  const dirty =
    kind === 'quiz'
      ? quizDirty
      : JSON.stringify(values) !== JSON.stringify(EMPTY);
  const { contentProps, requestClose, confirmation } = useDiscardGuard({
    dirty,
    discard: close,
  });

  const chooseKind = (next: Kind) => {
    if (kind === 'quiz' && quizDirty) {
      setSwitchTo(next);
    } else {
      setKind(next);
    }
  };

  const saveUpload = async () => {
    setShowErrors(true);
    if (hasErrors || !values.body) {
      return;
    }
    try {
      await createUpload({
        courseId,
        moduleId,
        title: values.title.trim(),
        body: values.body,
        maxPoints: Number(values.maxPoints),
        dueAt: dueAtToIso(values.dueAt),
      });
    } catch {
      // Surfaced via the error below; keep the dialog open.
      return;
    }
    close();
    void refreshCourse();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setKind('upload');
          setValues(EMPTY);
          setShowErrors(false);
          setQuizDirty(false);
          setSession((count) => count + 1);
          setOpen(true);
        } else {
          requestClose();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={
          kind === 'quiz'
            ? 'max-h-[90vh] overflow-y-auto pb-0 sm:max-w-5xl'
            : 'max-h-[90vh] overflow-y-auto sm:max-w-2xl'
        }
        {...contentProps}
      >
        <DialogHeader>
          <DialogTitle>New assignment</DialogTitle>
          <DialogDescription>
            An assignment is a lesson in this module that students complete for
            a grade.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Type</legend>
          {KINDS.map((option) => (
            <label
              key={option.kind}
              className="flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name="assignment-kind"
                  value={option.kind}
                  checked={kind === option.kind}
                  onChange={() => chooseKind(option.kind)}
                />
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {option.hint}
              </span>
            </label>
          ))}
        </fieldset>

        {kind === 'upload' ? (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void saveUpload();
            }}
          >
            {isError && (
              <ErrorAlert type="error" header="Couldn't create the assignment">
                {apiErrorMessage(error)}
              </ErrorAlert>
            )}
            <UploadAssignmentFields
              values={values}
              errors={errors}
              showErrors={showErrors}
              withTitle
              onChange={(next) =>
                setValues((current) => ({ ...current, ...next }))
              }
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Creating…' : 'Create assignment'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <QuizBuilder
            key={session}
            courseId={courseId}
            moduleId={moduleId}
            readOnlyReason={undefined}
            onAssignmentCreated={close}
            onDirtyChange={setQuizDirty}
            onClose={requestClose}
            onReload={() => undefined}
          />
        )}
        {confirmation}
        <DiscardChangesDialog
          open={switchTo !== undefined}
          onOpenChange={(next) => !next && setSwitchTo(undefined)}
          onDiscard={() => {
            if (switchTo) {
              setKind(switchTo);
              setQuizDirty(false);
            }
            setSwitchTo(undefined);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
