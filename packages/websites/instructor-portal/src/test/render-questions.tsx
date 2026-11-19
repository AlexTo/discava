/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AppRouter as CoreRouter } from '@discava/core-api';
import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { ReactElement } from 'react';
import { CoreApiTRPCContext } from '../api';
import { type ApiCall, fakeFetch, type Handler } from './fake-trpc-fetch';
import { renderWithInstructorApi } from './render-with-instructor-api';

export const lessonsView = (
  lessons: { lessonId: string; state?: 'hidden' | 'archived' }[],
  status = 'published',
) => ({
  status,
  modules: [
    {
      moduleId: 'm1',
      visibility: 'visible',
      lessons: lessons.map((l) => ({
        lessonId: l.lessonId,
        title: `Lesson ${l.lessonId}`,
        visibility: l.state === 'hidden' ? 'hidden' : 'visible',
        ...(l.state === 'archived' && { archivedAt: '2026-11-01T00:00:00Z' }),
        contentItems: [],
      })),
    },
  ],
});

// The Questions area reads the instructor API for queues, moderation and the
// course, and core-api for threads, replies and accepting.
export const renderQuestions = (
  ui: ReactElement,
  {
    instructor = {},
    core = {},
  }: { instructor?: Record<string, Handler>; core?: Record<string, Handler> },
) => {
  const coreCalls: ApiCall[] = [];
  const client = createTRPCClient<CoreRouter>({
    links: [
      httpLink({
        url: 'http://core-api.test/',
        fetch: fakeFetch(core, coreCalls),
      }),
    ],
  });
  const optionsProxy = createTRPCOptionsProxy<CoreRouter>({
    client,
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    }),
  });
  const rendered = renderWithInstructorApi(
    <CoreApiTRPCContext.Provider value={{ client, optionsProxy }}>
      {ui}
    </CoreApiTRPCContext.Provider>,
    { handlers: instructor },
  );
  return { ...rendered, coreCalls };
};
