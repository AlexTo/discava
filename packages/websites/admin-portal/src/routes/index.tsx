/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useAdminApi } from '../api';

export const Route = createFileRoute('/')({
  component: AdminHome,
});

function AdminHome() {
  const trpc = useAdminApi();
  const categories = useQuery(trpc.category.list.queryOptions());

  // A figure shows once its query has answered; a failed one shows none.
  const activeCategories = categories.data?.filter(
    (category) => category.status === 'active',
  ).length;

  const areas = [
    {
      to: '/categories',
      title: 'Categories',
      description: 'Add, rename and archive the categories courses sit in.',
      figure:
        activeCategories === undefined
          ? undefined
          : `${activeCategories} active ${activeCategories === 1 ? 'category' : 'categories'}`,
    },
    {
      to: '/reviews',
      title: 'Reviews',
      description: 'Read course reviews and remove ones that break the rules.',
      // No admin-api procedure totals the reviews, so no figure.
      figure: undefined,
    },
    {
      to: '/settings/notifications',
      title: 'Notification settings',
      description: 'Choose which notifications also reach you by email.',
      figure: undefined,
    },
  ];

  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-balance text-2xl font-bold tracking-tight">Admin</h1>
      <p className="text-sm text-muted-foreground">
        Manage the catalogue and moderate what learners post.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {areas.map((area) => (
          <li key={area.to}>
            <Link to={area.to} className="block h-full">
              <Card className="h-full transition-colors hover:bg-accent">
                <CardHeader>
                  <CardTitle>{area.title}</CardTitle>
                  <CardDescription>{area.description}</CardDescription>
                  {area.figure ? (
                    <p className="pt-2 text-sm font-medium">{area.figure}</p>
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
