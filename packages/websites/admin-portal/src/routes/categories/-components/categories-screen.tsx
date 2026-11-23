/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useReturnFocus } from '@discava/common-shadcn/hooks/use-return-focus';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useAdminApi } from '../../../api';

interface Category {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'archived';
  courseCount: number;
}

const NAME_PROBLEM = 'Enter a name for the category.';

export function CategoriesScreen() {
  usePageTitle('Categories');
  const trpc = useAdminApi();
  const queryClient = useQueryClient();
  const categories = useQuery(trpc.category.list.queryOptions());
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.category.list.queryKey() });

  const [newName, setNewName] = useState('');
  const [addProblem, setAddProblem] = useState<string>();
  const [renameProblem, setRenameProblem] = useState<string>();
  const addField = useRef<HTMLInputElement>(null);
  const renameField = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [archiving, setArchiving] = useState<Category>();
  const [announcement, setAnnouncement] = useState('');
  const returnFocus = useReturnFocus(archiving !== undefined);
  // Each row's Rename button, so focus can land there after the row changes.
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const archivedId = useRef<string>(undefined);
  const focusRename = (id: string) => renameButtons.current.get(id)?.focus();

  const create = useMutation(
    trpc.category.create.mutationOptions({
      onSuccess: async (_data, variables) => {
        setNewName('');
        setAnnouncement(`${variables.name.trim()} added.`);
        await refresh();
      },
    }),
  );
  const rename = useMutation(
    trpc.category.rename.mutationOptions({
      onSuccess: async (_data, variables) => {
        setRenaming(undefined);
        setAnnouncement(`Renamed to ${variables.name.trim()}.`);
        await refresh();
        focusRename(variables.id);
      },
    }),
  );
  const archive = useMutation(
    trpc.category.archive.mutationOptions({
      onSuccess: async (_data, variables) => {
        setAnnouncement(`${archiving?.name ?? 'Category'} archived.`);
        await refresh();
        archivedId.current = variables.id;
        setArchiving(undefined);
      },
    }),
  );

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) {
      setAddProblem(NAME_PROBLEM);
      addField.current?.focus();
      return;
    }
    create.mutate({ name: newName });
  };
  const onRename = (event: FormEvent) => {
    event.preventDefault();
    if (renaming && !renaming.name.trim()) {
      setRenameProblem(NAME_PROBLEM);
      renameField.current?.focus();
      return;
    }
    if (renaming) {
      rename.mutate({ id: renaming.id, name: renaming.name });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Categories</h1>
        <p className="text-sm text-muted-foreground">
          The taxonomy instructors choose from when they describe a course.
          Archiving a category hides it from new choices; courses keep it.
        </p>
      </header>

      <StatusMessage message={announcement} visuallyHidden />

      <form className="max-w-md space-y-3" noValidate onSubmit={onAdd}>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label htmlFor="new-category" className="text-sm font-medium">
              New category name
            </label>
            <Input
              id="new-category"
              ref={addField}
              aria-invalid={Boolean(addProblem ?? create.error)}
              aria-describedby={
                addProblem || create.error ? 'new-category-error' : undefined
              }
              value={newName}
              maxLength={60}
              onChange={(event) => {
                setNewName(event.target.value);
                setAddProblem(undefined);
                create.reset();
              }}
              placeholder="Science…"
            />
          </div>
          <PendingButton
            type="submit"
            pending={create.isPending}
            pendingLabel="Adding…"
          >
            Add category
          </PendingButton>
        </div>
        <div id="new-category-error">
          {addProblem && (
            <p className="text-sm text-destructive">{addProblem}</p>
          )}
          {create.isError && (
            <ErrorAlert type="error" header="Couldn't add the category">
              {apiErrorMessage(create.error)}
            </ErrorAlert>
          )}
        </div>
      </form>

      {categories.isPending && <LoadingState label="Loading the categories…" />}
      {categories.isError && (
        <ErrorAlert
          type="error"
          header="Couldn't load the categories"
          onRetry={() => categories.refetch()}
        >
          {apiErrorMessage(categories.error)}
        </ErrorAlert>
      )}
      {categories.data && (
        <table className="w-full max-w-3xl text-left text-sm max-sm:block">
          <thead className="border-b text-muted-foreground max-sm:sr-only">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Slug</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Courses</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {categories.data.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-4 text-muted-foreground max-sm:block"
                >
                  No categories yet.
                </td>
              </tr>
            )}
            {categories.data.map((category) => (
              <tr
                key={category.id}
                className="border-b max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-3 max-sm:[grid-template-areas:'name_name'_'slug_slug'_'status_count'_'actions_actions']"
              >
                <td className="min-w-0 break-words py-2 [overflow-wrap:anywhere] max-sm:block max-sm:py-0 max-sm:[grid-area:name]">
                  {renaming?.id === category.id ? (
                    <form className="space-y-2" noValidate onSubmit={onRename}>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          ref={renameField}
                          aria-invalid={Boolean(renameProblem ?? rename.error)}
                          aria-describedby={
                            renameProblem || rename.error
                              ? 'rename-category-error'
                              : undefined
                          }
                          className="min-w-0 flex-1 basis-40"
                          aria-label={`New name for ${category.name}`}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setRenaming(undefined);
                              rename.reset();
                              focusRename(category.id);
                            }
                          }}
                          value={renaming.name}
                          maxLength={60}
                          onChange={(event) => {
                            setRenaming({
                              id: category.id,
                              name: event.target.value,
                            });
                            setRenameProblem(undefined);
                            rename.reset();
                          }}
                        />
                        <PendingButton
                          type="submit"
                          size="sm"
                          pending={rename.isPending}
                          pendingLabel="Saving…"
                        >
                          Save
                        </PendingButton>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRenaming(undefined);
                            rename.reset();
                            focusRename(category.id);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                      <div id="rename-category-error">
                        {renameProblem && (
                          <p className="text-sm text-destructive">
                            {renameProblem}
                          </p>
                        )}
                        {rename.isError && (
                          <ErrorAlert
                            type="error"
                            header="Couldn't rename the category"
                          >
                            {apiErrorMessage(rename.error)}
                          </ErrorAlert>
                        )}
                      </div>
                    </form>
                  ) : (
                    category.name
                  )}
                </td>
                <td className="break-all py-2 font-mono text-xs max-sm:block max-sm:py-0 max-sm:[grid-area:slug]">
                  <span className="sm:sr-only">Slug: </span>
                  {category.slug}
                </td>
                <td className="py-2 max-sm:block max-sm:py-0 max-sm:[grid-area:status]">
                  <Badge
                    variant={
                      category.status === 'active' ? 'secondary' : 'outline'
                    }
                  >
                    {category.status === 'active' ? 'Active' : 'Archived'}
                  </Badge>
                </td>
                <td className="py-2 max-sm:block max-sm:py-0 max-sm:[grid-area:count]">
                  <span className="sm:sr-only">Courses: </span>
                  {category.courseCount}
                </td>
                <td className="py-2 text-right max-sm:block max-sm:py-0 max-sm:text-left max-sm:[grid-area:actions]">
                  <div className="flex flex-wrap justify-end gap-2 max-sm:justify-start">
                    <Button
                      ref={(element) => {
                        if (element) {
                          renameButtons.current.set(category.id, element);
                        } else {
                          renameButtons.current.delete(category.id);
                        }
                      }}
                      size="sm"
                      variant="outline"
                      aria-label={`Rename ${category.name}`}
                      onClick={() => {
                        setRenaming({ id: category.id, name: category.name });
                        setRenameProblem(undefined);
                        rename.reset();
                      }}
                    >
                      Rename
                    </Button>
                    {category.status === 'active' && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Archive ${category.name}`}
                        onClick={() => setArchiving(category)}
                      >
                        Archive
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AlertDialog
        open={archiving !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setArchiving(undefined);
            archive.reset();
          }
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            const id = archivedId.current;
            archivedId.current = undefined;
            if (id && renameButtons.current.has(id)) {
              event.preventDefault();
              focusRename(id);
              return;
            }
            returnFocus.onCloseAutoFocus(event);
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Instructors will no longer be offered it for their courses.{' '}
              {archiving?.courseCount
                ? `${archiving.courseCount} ${archiving.courseCount === 1 ? 'course keeps' : 'courses keep'} it.`
                : 'No course has it.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archive.isError && (
            <ErrorAlert type="error" header="Couldn't archive the category">
              {apiErrorMessage(archive.error)}
            </ErrorAlert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <PendingButton
              pending={archive.isPending}
              pendingLabel="Archiving…"
              onClick={() => {
                if (archiving) {
                  archive.mutate({ id: archiving.id });
                }
              }}
            >
              Archive
            </PendingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
