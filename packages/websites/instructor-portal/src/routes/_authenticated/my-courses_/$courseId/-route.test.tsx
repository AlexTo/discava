/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Handler,
  renderWithInstructorApi,
} from '../../../../test/render-with-instructor-api';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    useLocation: () => ({ pathname: '/my-courses/c1' }),
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { hash: string } }) => string;
    }) => select({ location: { hash: '' } }),
    Link: ({
      children,
      to,
      hash,
    }: {
      children: React.ReactNode;
      to: string;
      hash?: string;
    }) => <a href={hash ? `/my-courses/c1#${hash}` : to}>{children}</a>,
  });
});

const { Route } = await import('./route');
const RouteComponent = Route.options.component!;

const course = (extra: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  title: 'Course',
  status: 'published',
  updatedAt: '2026-01-01T00:00:00.000Z',
  certificatesEnabled: true,
  certificateCriteria: { requireQuizPass: false, minUploadScorePercent: 0 },
  defaultFirstLessonPrompt: '',
  priceAmount: 0,
  priceCurrency: 'USD',
  modules: [],
  ...extra,
});

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithInstructorApi(<RouteComponent />, {
    handlers: {
      'course.view': () => course(),
      'profile.get': () => ({}),
      'course.captionLanguages': () => ({
        languages: [],
        supported: [],
        enabled: true,
        maxLanguages: 3,
      }),
      'certificate.list': () => ({ items: [] }),
      'announcement.list': () => ({ items: [] }),
      ...handlers,
    },
  });

beforeEach(() => {
  vi.spyOn(Route, 'useParams').mockReturnValue({ courseId: 'c1' });
});

const h2s = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('course editor', () => {
  it('puts the course content first, then the settings, announcements and archived', async () => {
    render({
      'course.view': () =>
        course({
          modules: [
            {
              moduleId: 'm1',
              title: 'Gone',
              archivedAt: '2026-01-02T00:00:00.000Z',
              lessons: [],
            },
          ],
        }),
    });
    await screen.findByRole('heading', { name: 'Course content' });
    const names = h2s();
    const order = [
      'Course content',
      'Landing page',
      'Catalogue details',
      'Caption languages',
      'Certificates',
      'First-lesson prompt',
      'Price',
      'Announcements',
      'Archived',
    ];
    expect(names.filter((name) => order.includes(name ?? ''))).toEqual(order);
  });

  it('links to the sections on the page, and not to an absent one', async () => {
    render();
    const nav = await screen.findByRole('navigation', {
      name: 'Course sections',
    });
    expect(nav).toHaveTextContent('Announcements');
    expect(nav).not.toHaveTextContent('Archived');
  });

  it('keeps every linked heading clear of the sticky header when scrolled to', async () => {
    render({
      'course.view': () =>
        course({
          modules: [
            {
              moduleId: 'm1',
              title: 'Gone',
              archivedAt: '2026-01-02T00:00:00.000Z',
              lessons: [],
            },
          ],
        }),
    });
    const nav = await screen.findByRole('navigation', {
      name: 'Course sections',
    });
    await vi.waitFor(() =>
      expect(within(nav).getAllByRole('link')).toHaveLength(9),
    );
    for (const link of within(nav).getAllByRole('link')) {
      const id = link.getAttribute('href')?.split('#')[1] ?? '';
      // The portal's header is sticky and h-16 (4rem); the margin is wider.
      expect(document.getElementById(id)).toHaveClass('scroll-mt-20');
    }
  });

  it('has no link or section for captions when translation is off', async () => {
    render({
      'course.captionLanguages': () => ({
        languages: [],
        supported: [],
        enabled: false,
        maxLanguages: 3,
      }),
    });
    await screen.findByRole('heading', { name: 'Course content' });
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Captions' }),
      ).not.toBeInTheDocument(),
    );
  });
});
