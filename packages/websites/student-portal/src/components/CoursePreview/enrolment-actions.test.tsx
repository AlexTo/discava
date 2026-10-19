/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../test/render-with-core-api';
import { CoursePreview } from './index';

const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  description: 'Vectors, matrices and the four subspaces.',
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  modules: [
    {
      moduleId: 'module-1',
      title: 'Unit 1',
      lessons: [{ lessonId: 'lesson-1', title: 'Lecture 1' }],
    },
  ],
};

const enrolment = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  userId: 'student-1',
  status: 'active',
  progressPercent: 0,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const renderPreview = (
  handlers: Record<string, Handler> = {},
  { signedIn = true } = {},
) =>
  renderWithCoreApi(
    <CoursePreview
      courseCode="course-1"
      backTo="/"
      backLabel="Back to Explore"
    />,
    {
      signedIn,
      handlers: { 'course.publicView': () => course, ...handlers },
    },
  );

const enrolButton = () => screen.findByRole('button', { name: 'Enrol now' });

describe('EnrolmentActions', () => {
  it('asks a signed-out visitor to sign in, without calling the API', async () => {
    const { user, calls } = renderPreview({}, { signedIn: false });

    await user.click(await enrolButton());

    const dialog = await screen.findByRole('dialog', {
      name: 'Sign in to enrol',
    });
    expect(
      within(dialog).getByRole('link', { name: 'Continue to sign in' }),
    ).toHaveAttribute('href', '/signin');
    expect(calls.map(({ path }) => path)).toEqual(['course.publicView']);
  });

  it('enrols a signed-in student who is not enrolled yet', async () => {
    const { user, calls } = renderPreview({
      'course.myEnrolment': () => null,
      'course.enrol': () => enrolment(),
    });

    await user.click(await enrolButton());

    const dialog = await screen.findByRole('dialog', {
      name: "You're enrolled!",
    });
    expect(
      within(dialog).getByRole('link', { name: 'Start learning' }),
    ).toHaveAttribute('href', '/course/course-1');
    expect(calls).toContainEqual({
      path: 'course.enrol',
      input: { courseId: 'course-1' },
    });

    // Behind the dialog, the card now offers to start rather than enrol.
    await user.click(
      within(dialog).getByRole('button', { name: 'Keep browsing' }),
    );
    expect(screen.getByText('0% complete')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Start learning' }),
    ).toHaveAttribute('href', '/course/course-1');
    expect(screen.queryByRole('button', { name: 'Enrol now' })).toBeNull();
  });

  it('shows an enrolled student their progress and a way back in', async () => {
    const { calls } = renderPreview({
      'course.myEnrolment': () => enrolment({ progressPercent: 40 }),
    });

    expect(
      await screen.findByRole('link', { name: 'Continue learning' }),
    ).toHaveAttribute('href', '/course/course-1');
    expect(screen.getByText('40% complete')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Course progress' }),
    ).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByRole('button', { name: 'Enrol now' })).toBeNull();
    expect(calls.map(({ path }) => path)).not.toContain('course.enrol');
  });

  it('shows when a student completed the course', async () => {
    renderPreview({
      'course.myEnrolment': () =>
        enrolment({
          status: 'completed',
          progressPercent: 100,
          completedAt: '2026-10-10T12:00:00.000Z',
        }),
    });

    expect(
      await screen.findByRole('link', { name: 'Review course' }),
    ).toHaveAttribute('href', '/course/course-1');
    expect(screen.getByText(/Completed on/)).toBeInTheDocument();
  });

  it("doesn't offer to enrol a student whose enrolment has ended", async () => {
    renderPreview({
      'course.myEnrolment': () => enrolment({ status: 'dropped' }),
    });

    expect(
      await screen.findByText("You're no longer enrolled"),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enrol now' })).toBeNull();
    expect(screen.queryByRole('link', { name: /learning/ })).toBeNull();
  });

  it('explains when the course closed before enrolling', async () => {
    const { user } = renderPreview({
      'course.myEnrolment': () => null,
      'course.enrol': () => {
        throw new ApiError('NOT_FOUND', 'Not found');
      },
    });

    await user.click(await enrolButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This course is no longer open for enrolment.',
    );
    expect(screen.getByRole('button', { name: 'Enrol now' })).toBeEnabled();
  });

  it('shows any other enrolment error as it is', async () => {
    const { user } = renderPreview({
      'course.myEnrolment': () => null,
      'course.enrol': () => {
        throw new ApiError(
          'CONFLICT',
          'Another request was changing the same records; nothing was changed. Please retry',
        );
      },
    });

    await user.click(await enrolButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another request was changing the same records',
    );
  });

  it('still offers to enrol when the enrolment check fails', async () => {
    renderPreview({
      'course.myEnrolment': () => {
        throw new Error('Service unavailable');
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't check your enrolment",
    );
    expect(await enrolButton()).toBeEnabled();
  });
});
