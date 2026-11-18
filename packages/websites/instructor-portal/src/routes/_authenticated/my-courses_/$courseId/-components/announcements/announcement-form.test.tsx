/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { AnnouncementForm } from './announcement-form';

const COURSE_ID = 'course-1';

const body = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
});

const posted = { announcementId: 'x', title: 'Welcome', body };

const typeAnnouncement = async (user: { type: Function }) => {
  await user.type(screen.getByLabelText('Title'), 'Welcome');
  await user.type(screen.getByLabelText('Announcement text'), 'Hello');
};

describe('AnnouncementForm', () => {
  it('disables Post until there is a title and text, and counts the title', async () => {
    const { user } = renderWithInstructorApi(
      <AnnouncementForm courseId={COURSE_ID} />,
    );
    const post = screen.getByRole('button', { name: 'Post announcement' });
    expect(post).toBeDisabled();
    expect(
      screen.getByText(
        'Posting notifies the students enrolled in this course.',
      ),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Title'), 'Welcome');
    expect(screen.getByText('7/120')).toBeInTheDocument();
    expect(post).toBeDisabled();
    await user.type(screen.getByLabelText('Announcement text'), 'Hello');
    expect(post).toBeEnabled();
  });

  it('posts with a UUID v7, refreshes the list and starts a new post with a new id', async () => {
    const { calls, queryClient, user } = renderWithInstructorApi(
      <AnnouncementForm courseId={COURSE_ID} />,
      { handlers: { 'announcement.create': () => posted } },
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await typeAnnouncement(user);
    await user.click(screen.getByRole('button', { name: 'Post announcement' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''));

    await typeAnnouncement(user);
    await user.click(screen.getByRole('button', { name: 'Post announcement' }));
    await waitFor(() => expect(calls).toHaveLength(2));

    const [first, second] = calls.map(
      (call) => (call.input as { announcementId: string }).announcementId,
    );
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(second).not.toBe(first);
    expect(calls[0]?.input).toMatchObject({
      courseId: COURSE_ID,
      title: 'Welcome',
    });
  });

  it('keeps what was typed and the same id when a post fails, so a retry is the same post', async () => {
    let attempt = 0;
    const { calls, user } = renderWithInstructorApi(
      <AnnouncementForm courseId={COURSE_ID} />,
      {
        handlers: {
          'announcement.create': () => {
            attempt += 1;
            if (attempt === 1) {
              throw new ApiError('INTERNAL_SERVER_ERROR', 'Try later');
            }
            return posted;
          },
        },
      },
    );

    await typeAnnouncement(user);
    await user.click(screen.getByRole('button', { name: 'Post announcement' }));
    expect(await screen.findByText('Try later')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Welcome');

    await user.click(screen.getByRole('button', { name: 'Post announcement' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.input).toEqual(calls[0]?.input);
  });

  describe('editing', () => {
    const announcement = {
      announcementId: 'a1',
      title: 'Welcome',
      body,
      version: 3,
    };

    it('is prefilled and sends the version it read', async () => {
      const onDone = vi.fn();
      const { calls, user } = renderWithInstructorApi(
        <AnnouncementForm
          courseId={COURSE_ID}
          announcement={announcement}
          onDone={onDone}
        />,
        { handlers: { 'announcement.update': () => ({}) } },
      );
      expect(screen.getByLabelText('Title')).toHaveValue('Welcome');
      await user.type(screen.getByLabelText('Title'), '!');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(calls[0]).toMatchObject({
        path: 'announcement.update',
        input: {
          courseId: COURSE_ID,
          announcementId: 'a1',
          version: 3,
          title: 'Welcome!',
        },
      });
    });

    it('shows the conflict message with a Reload that refetches the list', async () => {
      const onDone = vi.fn();
      const { queryClient, user } = renderWithInstructorApi(
        <AnnouncementForm
          courseId={COURSE_ID}
          announcement={announcement}
          onDone={onDone}
        />,
        {
          handlers: {
            'announcement.update': () => {
              throw new ApiError(
                'CONFLICT',
                'This announcement changed. Reload to see the latest text.',
              );
            },
          },
        },
      );
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(
        await screen.findByText(
          'This announcement changed. Reload to see the latest text.',
        ),
      ).toBeInTheDocument();
      expect(onDone).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it('has no arrow icons in its buttons', () => {
    renderWithInstructorApi(<AnnouncementForm courseId={COURSE_ID} />);
    expect(
      screen
        .getByRole('button', { name: 'Post announcement' })
        .querySelector('svg'),
    ).toBeNull();
  });
});
