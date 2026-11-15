/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../test/render-with-core-api';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { profile: { sub: 'instructor-1' } } }),
}));

const { Route } = await import('./route');
const RouteComponent = Route.options.component!;

const course = (
  courseId: string,
  title: string,
  status: 'draft' | 'published' | 'archived',
) => ({ courseId, title, status });

const renderPage = (handlers = {}) =>
  renderWithCoreApi(<RouteComponent />, { handlers });

describe('Dashboard', () => {
  it("loads the instructor's real courses from course.listByInstructor", async () => {
    const { calls } = renderPage({
      'course.listByInstructor': () => ({
        items: [
          course('c1', 'Intro to DynamoDB', 'published'),
          course('c2', 'Advanced Queries', 'draft'),
        ],
        cursor: null,
      }),
    });

    expect(
      screen.getByRole('heading', { name: 'Dashboard' }),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.listByInstructor',
          input: { instructorId: 'instructor-1', limit: 100 },
        },
      ]),
    );
  });

  it('counts active (published) courses from the real list', async () => {
    renderPage({
      'course.listByInstructor': () => ({
        items: [
          course('c1', 'Intro to DynamoDB', 'published'),
          course('c2', 'Advanced Queries', 'draft'),
          course('c3', 'Data Modelling', 'published'),
        ],
        cursor: null,
      }),
    });

    await waitFor(() =>
      expect(screen.getByText('Active courses')).toBeInTheDocument(),
    );
    const tile = screen
      .getByText('Active courses')
      .closest('[data-slot="card"]');
    expect(tile).toHaveTextContent('2');

    const enrolled = screen
      .getByText('Enrolled students')
      .closest('[data-slot="card"]');
    expect(enrolled).toHaveTextContent('Across 3 courses');
  });

  it('invites creating a course instead of showing charts when there are none', async () => {
    renderPage({
      'course.listByInstructor': () => ({ items: [], cursor: null }),
    });

    expect(
      await screen.findByText(
        'No courses yet — create one to see enrollment trends here.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No courses yet — create one to see progress breakdowns here.',
      ),
    ).toBeInTheDocument();
  });

  it("shows the API's error when the list fails to load", async () => {
    renderPage({
      'course.listByInstructor': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something went wrong');
      },
    });

    expect(
      await screen.findByText("Couldn't load your courses"),
    ).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
