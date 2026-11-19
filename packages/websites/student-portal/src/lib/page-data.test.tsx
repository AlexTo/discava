/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppRouter } from '@discava/core-api';
import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { CoursePage } from '../routes/learn/$courseId/-components/course-page';
import { renderWithCoreApi } from '../test/render-with-core-api';
import { seedFromPageData } from './page-data';

const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  description: 'Vectors and matrices.',
  status: 'published',
  priceAmount: 0,
  priceCurrency: 'USD',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  learningOutcomes: ['Solve linear systems'],
  requirements: [],
  instructors: [],
  modules: [],
};
const summary = { count: 0, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

const putPageData = (text: string) => {
  const element = document.createElement('script');
  element.type = 'application/json';
  element.id = 'discava-page-data';
  element.textContent = text;
  document.body.append(element);
};

const proxyFor = (queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({
    client: createTRPCClient<AppRouter>({
      links: [httpLink({ url: 'http://unused.test/' })],
    }),
    queryClient,
  });

afterEach(() => {
  document.getElementById('discava-page-data')?.remove();
});

describe('seedFromPageData', () => {
  it('renders a seeded course page with no spinner and no request', async () => {
    putPageData(
      JSON.stringify({
        'course.publicView': course,
        'review.summary': summary,
        'review.list': { items: [], cursor: null },
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedFromPageData(queryClient, proxyFor(queryClient));
    expect(document.getElementById('discava-page-data')).toBeNull();

    const { calls } = renderWithCoreApi(<CoursePage courseId="course-1" />, {
      signedIn: false,
      queryClient,
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Linear Algebra' }),
    ).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('ignores a malformed element', () => {
    putPageData('{not json');
    const queryClient = new QueryClient();
    seedFromPageData(queryClient, proxyFor(queryClient));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(document.getElementById('discava-page-data')).toBeNull();
  });

  it('does nothing without an element', () => {
    const queryClient = new QueryClient();
    seedFromPageData(queryClient, proxyFor(queryClient));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('seeds a profile under its handle', () => {
    putPageData(
      JSON.stringify({
        'instructorProfile.publicView': {
          handle: 'ada',
          displayName: 'Ada',
          courses: [],
        },
      }),
    );
    const queryClient = new QueryClient();
    const trpc = proxyFor(queryClient);
    seedFromPageData(queryClient, trpc);
    expect(
      queryClient.getQueryData(
        trpc.instructorProfile.publicView.queryKey({ handle: 'ada' }),
      ),
    ).toMatchObject({ displayName: 'Ada' });
  });
});
