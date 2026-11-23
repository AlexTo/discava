/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { useDiscardGuard } from '@discava/common-shadcn/hooks/use-discard-guard';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { z } from 'zod';
import { useInstructorApi } from '../../../../../../api';

const moduleFormSchema = z.object({
  title: z.string().trim().min(1, 'Module title is required').max(200),
  description: z.string(),
});

export function EditModuleDialog({
  courseId,
  moduleId,
  title,
  description,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  title: string;
  description?: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { course, module } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: updateModule,
    reset: resetUpdateModule,
    isError,
    error,
  } = useMutation(module.update.mutationOptions());

  const form = useForm({
    defaultValues: { title, description: description ?? '' },
    validators: { onChange: moduleFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await updateModule({
          courseId,
          moduleId,
          title: value.title.trim(),
          description: value.description,
        });
      } catch {
        // Surfaced via the error below; keep the dialog open.
        return;
      }
      setOpen(false);
      form.reset({ ...value, title: value.title.trim() });
      void queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
    },
  });

  const dirty = useStore(form.store, (state) => state.isDirty);
  const close = () => {
    setOpen(false);
    form.reset();
    resetUpdateModule();
  };
  const { contentProps, requestClose, confirmation } = useDiscardGuard({
    dirty,
    discard: close,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : requestClose())}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md" {...contentProps}>
        <DialogHeader>
          <DialogTitle>Edit module</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Update the title and description students see for this module.
          </p>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {isError && (
            <ErrorAlert type="error" header="Couldn't update the module">
              {apiErrorMessage(error)}
            </ErrorAlert>
          )}

          <form.Field name="title">
            {({ name, state, handleBlur, handleChange }) => {
              const error = state.meta.errors[0];
              return (
                <div className="space-y-2">
                  <Label htmlFor={name}>Module title</Label>
                  <Input
                    id={name}
                    name={name}
                    value={state.value}
                    onBlur={handleBlur}
                    onChange={(event) => handleChange(event.target.value)}
                    placeholder="e.g. Introduction to the course"
                    aria-invalid={Boolean(error)}
                    autoFocus
                  />
                  {error && (
                    <p className="text-xs text-destructive">{error.message}</p>
                  )}
                </div>
              );
            }}
          </form.Field>

          <form.Field name="description">
            {({ name, state, handleBlur, handleChange }) => (
              <div className="space-y-2">
                <Label htmlFor={name}>Description</Label>
                <Textarea
                  id={name}
                  name={name}
                  value={state.value}
                  onBlur={handleBlur}
                  onChange={(event) => handleChange(event.target.value)}
                  placeholder="What this module covers"
                  rows={6}
                />
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
            >
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? 'Saving…' : 'Save changes'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
        {confirmation}
      </DialogContent>
    </Dialog>
  );
}
