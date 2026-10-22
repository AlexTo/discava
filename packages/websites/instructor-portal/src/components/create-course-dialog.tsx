/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { z } from 'zod';
import { useInstructorApi } from '../hooks/useInstructorApi';
import { Alert } from './alert';

const courseFormSchema = z.object({
  title: z.string().trim().min(1, 'Course title is required').max(200),
  description: z.string().max(2000, 'Keep the summary under 2000 characters'),
});

export function CreateCourseDialog({ trigger }: { trigger: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const trpc = useInstructorApi();
  const createCourse = useMutation(trpc.course.create.mutationOptions());

  const form = useForm({
    defaultValues: { title: '', description: '' },
    validators: { onChange: courseFormSchema },
    onSubmit: async ({ value }) => {
      try {
        const course = await createCourse.mutateAsync({
          title: value.title.trim(),
          description: value.description.trim() || undefined,
        });
        setOpen(false);
        void navigate({
          to: '/my-courses/$courseId',
          params: { courseId: course.courseId },
        });
      } catch {
        // Surfaced via createCourse.error below; keep the dialog open.
      }
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          form.reset();
          createCourse.reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-xl">Create a course</DialogTitle>
            <Badge variant="secondary">Draft</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Set up the course details. You will add modules, lessons, and
            assessments from the course page afterward.
          </p>
        </DialogHeader>

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {createCourse.isError && (
            <Alert type="error" header="Couldn't create the course">
              {apiErrorMessage(createCourse.error)}
            </Alert>
          )}

          <Card className="gap-5 py-5">
            <CardHeader className="px-5 sm:px-6">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <FileText className="size-5" />
                </div>
                <div>
                  <CardTitle id="basics-heading" className="text-lg">
                    Basic course information
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Help instructors and students identify the course.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 px-5 sm:px-6">
              <form.Field name="title">
                {(field) => {
                  const error = field.state.meta.errors[0];
                  return (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Course title</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder="e.g. Foundations of Environmental Science"
                        aria-invalid={Boolean(error)}
                      />
                      {error ? (
                        <p className="text-xs text-destructive">
                          {error.message}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Use a clear title that students will recognise.
                        </p>
                      )}
                    </div>
                  );
                }}
              </form.Field>

              <form.Field name="description">
                {(field) => {
                  const error = field.state.meta.errors[0];
                  return (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Course summary</Label>
                      <Textarea
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        className="min-h-32 resize-y"
                        placeholder="Describe what students will learn and who this course is for."
                        aria-invalid={Boolean(error)}
                      />
                      <p
                        className={`text-right text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
                      >
                        {error
                          ? error.message
                          : `${field.state.value.length} / 2000 characters`}
                      </p>
                    </div>
                  );
                }}
              </form.Field>
            </CardContent>
          </Card>

          <footer className="flex items-center justify-end gap-3 border-t pt-4">
            <Button
              variant="outline"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
            >
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save'}
                </Button>
              )}
            </form.Subscribe>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
