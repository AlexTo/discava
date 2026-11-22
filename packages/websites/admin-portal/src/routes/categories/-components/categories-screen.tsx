/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
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
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useAdminApi } from '../../../api';

interface Category {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'archived';
  courseCount: number;
}

export function CategoriesScreen() {
  const trpc = useAdminApi();
  const queryClient = useQueryClient();
  const categories = useQuery(trpc.category.list.queryOptions());
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.category.list.queryKey() });

  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [archiving, setArchiving] = useState<Category>();

  const create = useMutation(
    trpc.category.create.mutationOptions({
      onSuccess: async () => {
        setNewName('');
        await refresh();
      },
    }),
  );
  const rename = useMutation(
    trpc.category.rename.mutationOptions({
      onSuccess: async () => {
        setRenaming(undefined);
        await refresh();
      },
    }),
  );
  const archive = useMutation(
    trpc.category.archive.mutationOptions({
      onSuccess: refresh,
      onSettled: () => setArchiving(undefined),
    }),
  );

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ name: newName });
  };
  const onRename = (event: FormEvent) => {
    event.preventDefault();
    if (renaming) {
      rename.mutate({ id: renaming.id, name: renaming.name });
    }
  };

  const error = create.error ?? rename.error ?? archive.error;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Categories</h1>
        <p className="text-sm text-muted-foreground">
          The taxonomy instructors choose from when they describe a course.
          Archiving a category hides it from new choices; courses keep it.
        </p>
      </header>

      {error && (
        <ErrorAlert type="error" header="That didn't work">
          {apiErrorMessage(error)}
        </ErrorAlert>
      )}

      <form className="flex max-w-md items-end gap-2" onSubmit={onAdd}>
        <div className="flex-1 space-y-1">
          <label htmlFor="new-category" className="text-sm font-medium">
            New category name
          </label>
          <Input
            id="new-category"
            value={newName}
            maxLength={60}
            onChange={(event) => {
              setNewName(event.target.value);
              create.reset();
            }}
            placeholder="e.g. Science"
          />
        </div>
        <Button type="submit" disabled={!newName.trim() || create.isPending}>
          Add category
        </Button>
      </form>

      {categories.isPending && <Spinner />}
      {categories.isError && (
        <ErrorAlert type="error" header="Couldn't load the categories">
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
                    <form className="flex flex-wrap gap-2" onSubmit={onRename}>
                      <Input
                        className="min-w-0 flex-1 basis-40"
                        aria-label={`New name for ${category.name}`}
                        value={renaming.name}
                        maxLength={60}
                        onChange={(event) => {
                          setRenaming({
                            id: category.id,
                            name: event.target.value,
                          });
                          rename.reset();
                        }}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!renaming.name.trim() || rename.isPending}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRenaming(undefined);
                          rename.reset();
                        }}
                      >
                        Cancel
                      </Button>
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
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRenaming({ id: category.id, name: category.name });
                        rename.reset();
                      }}
                    >
                      Rename
                    </Button>
                    {category.status === 'active' && (
                      <Button
                        size="sm"
                        variant="outline"
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
        onOpenChange={(open) => !open && setArchiving(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Instructors will no longer be offered it for their courses.{' '}
              {archiving?.courseCount
                ? `${archiving.courseCount} ${archiving.courseCount === 1 ? 'course keeps' : 'courses keep'} it.`
                : 'No course has it.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (archiving) {
                  archive.mutate({ id: archiving.id });
                }
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
