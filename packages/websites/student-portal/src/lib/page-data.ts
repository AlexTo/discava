/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AppRouter } from '@discava/core-api';
import type { QueryClient } from '@tanstack/react-query';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';

const PAGE_DATA_ID = 'discava-page-data';
// The reviews' page size the course page asks for.
const REVIEW_PAGE_SIZE = 10;
// How long seeded answers count as fresh: the page renderer's own cache time,
// so the first render never asks the API again for what it was just sent.
const SEEDED_STALE_MS = 5 * 60 * 1000;

type Trpc = TRPCOptionsProxy<AppRouter>;
type PageData = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readPageData = (): PageData | undefined => {
  const element = document.getElementById(PAGE_DATA_ID);
  if (!element) {
    return undefined;
  }
  element.remove();
  try {
    const parsed: unknown = JSON.parse(element.textContent ?? '');
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    // A malformed element is ignored: the page loads its data as usual.
    return undefined;
  }
};

/**
 * Puts what the page renderer wrote into the page (`#discava-page-data`, keyed
 * by tRPC path) into the query cache under the keys the components use, so a
 * landing page or profile shows its content at first paint with no request.
 * Reads the element once and removes it.
 */
export const seedFromPageData = (
  queryClient: QueryClient,
  trpc: Trpc,
): void => {
  const data = readPageData();
  if (!data) {
    return;
  }

  const seed = (key: readonly unknown[], value: unknown) => {
    queryClient.setQueryData(key, value);
    queryClient.setQueryDefaults(key, { staleTime: SEEDED_STALE_MS });
  };

  const course = data['course.publicView'];
  if (isRecord(course) && typeof course.courseId === 'string') {
    const courseId = course.courseId;
    seed(trpc.course.publicView.queryKey({ courseId }), course as never);
    const summary = data['review.summary'];
    if (isRecord(summary)) {
      seed(trpc.review.summary.queryKey({ courseId }), summary as never);
    }
    const reviews = data['review.list'];
    if (isRecord(reviews) && Array.isArray(reviews.items)) {
      seed(
        trpc.review.list.infiniteQueryKey({
          courseId,
          limit: REVIEW_PAGE_SIZE,
        }),
        { pages: [reviews], pageParams: [undefined] },
      );
    }
  }

  const profile = data['instructorProfile.publicView'];
  if (isRecord(profile) && typeof profile.handle === 'string') {
    seed(
      trpc.instructorProfile.publicView.queryKey({ handle: profile.handle }),
      profile as never,
    );
  }
};
