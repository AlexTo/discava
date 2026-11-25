/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCoreApi } from '../../api';
import { CatalogueResults } from '../../components/catalogue-results';
import { PageBreadcrumbs } from '../../components/page-breadcrumbs';
import { PageContainer } from '../../components/page-container';
import {
  type CatalogueFilters,
  catalogueFiltersToSearch,
  parseCatalogueFilters,
} from '../../lib/catalogue-filters';

// Every course, with the category chips and the filter panel. The home page
// only shows a few; this is where a student narrows them down.
export const Route = createFileRoute('/courses/')({
  // The filters live in the address.
  validateSearch: (search: Record<string, unknown>) =>
    catalogueFiltersToSearch(parseCatalogueFilters(search)),
  component: RouteComponent,
});

function RouteComponent() {
  usePageTitle('Browse courses');
  const filters = parseCatalogueFilters(Route.useSearch());
  const navigate = Route.useNavigate();
  const setFilters = (next: CatalogueFilters) =>
    navigate({ search: catalogueFiltersToSearch(next) });

  const trpc = useCoreApi();
  const categoriesQuery = useQuery(trpc.category.list.queryOptions());
  const categories = categoriesQuery.data ?? [];

  // Searching is the top bar's job (/search); this narrows by category and
  // the filters beside the courses.
  return (
    <PageContainer>
      <PageBreadcrumbs crumbs={[{ label: 'Courses' }]} className="mb-6" />
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Browse courses for every goal.
        </h1>
        <p className="mt-4 text-muted-foreground">
          Choose a category, or search for a topic above, to find your next
          learning opportunity.
        </p>
      </div>

      {categories.length > 0 && (
        <div className="mt-8 flex flex-col gap-4 rounded-2xl border bg-muted/30 p-4 sm:p-5">
          <div
            className="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0 [&>*]:shrink-0"
            role="group"
            aria-label="Course categories"
          >
            <Button
              type="button"
              size="sm"
              variant={filters.category ? 'outline' : 'default'}
              onClick={() => setFilters({ ...filters, category: undefined })}
            >
              All
            </Button>
            {categories.map(({ id, name, slug, courseCount }) => (
              <Button
                key={id}
                size="sm"
                variant={filters.category === slug ? 'default' : 'outline'}
                asChild
              >
                <Link to="/category/$slug" params={{ slug }}>
                  {name} ({courseCount})
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      <CatalogueResults
        filters={filters}
        onFiltersChange={setFilters}
        emptyMessage="Try other filters, or clear them to see every course."
      />
    </PageContainer>
  );
}
