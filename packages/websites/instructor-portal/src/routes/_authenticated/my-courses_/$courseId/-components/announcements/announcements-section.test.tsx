/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { AnnouncementsSection } from './announcements-section';

const body = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
  ],
});

const item = (n: number, extra = {}) => ({
  announcementId: `a${n}`,
  courseId: 'course-1',
  title: `Title ${n}`,
  body,
  authorId: 'u1',
  authorName: 'Alice Smith',
  createdAt: '2026-11-01T10:00:00.000Z',
  version: 1,
  ...extra,
});

const render = (archived: boolean, list: (input: unknown) => unknown) =>
  renderWithInstructorApi(
    <AnnouncementsSection courseId="course-1" archived={archived} />,
    { handlers: { 'announcement.list': list } },
  );

describe('AnnouncementsSection', () => {
  it('shows the empty state and the form', async () => {
    render(false, () => ({ items: [] }));
    expect(
      await screen.findByText('No announcements yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Post announcement' }),
    ).toBeInTheDocument();
  });

  it('lists announcements with edit and delete, and loads more', async () => {
    const { calls, user } = render(false, (input) =>
      (input as { cursor?: string }).cursor
        ? { items: [item(2)] }
        : {
            items: [item(1, { editedAt: '2026-11-02T10:00:00.000Z' })],
            cursor: 'c1',
          },
    );
    expect(await screen.findByText('Title 1')).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Title 1' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Delete Title 1' }),
    ).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Title 2')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === 'announcement.list')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  it('swaps an item for the edit form', async () => {
    const { user } = render(false, () => ({ items: [item(1)] }));
    await user.click(
      await screen.findByRole('button', { name: 'Edit Title 1' }),
    );
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Title 1')).toBeInTheDocument();
  });

  it('replaces the form for an archived course but keeps edit and delete', async () => {
    render(true, () => ({ items: [item(1)] }));
    expect(
      await screen.findByText("Archived courses can't have new announcements."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Post announcement' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Edit Title 1' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Delete Title 1' }),
    ).toBeEnabled();
  });

  it('shows a load error with Try again', async () => {
    let fail = true;
    const { user } = render(false, () => {
      if (fail) {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
      }
      return { items: [] };
    });
    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByText('No announcements yet.')).toBeInTheDocument(),
    );
  });

  it('lets a long announcement title wrap', async () => {
    render(false, () => ({ items: [item(1, { title: 'x'.repeat(80) })] }));

    expect(
      await screen.findByRole('heading', { name: 'x'.repeat(80) }),
    ).toHaveClass('break-words');
  });

  it('focuses the title on Edit, and the Edit button on Cancel', async () => {
    const { user } = render(true, () => ({ items: [item(1)] }));
    await user.click(
      await screen.findByRole('button', { name: 'Edit Title 1' }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Title' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Edit Title 1' }),
      ),
    );
  });

  it('focuses the Edit button after Save', async () => {
    const { user } = renderWithInstructorApi(
      <AnnouncementsSection courseId="course-1" archived />,
      {
        handlers: {
          'announcement.list': () => ({ items: [item(1)] }),
          'announcement.update': () => item(1),
        },
      },
    );
    await user.click(
      await screen.findByRole('button', { name: 'Edit Title 1' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Edit Title 1' }),
      ),
    );
  });

  it("focuses the next item's Edit after a delete, else the heading", async () => {
    let items = [item(1), item(2)];
    const { user } = renderWithInstructorApi(
      <>
        <h2 id="announcements-heading" tabIndex={-1}>
          Announcements
        </h2>
        <AnnouncementsSection courseId="course-1" archived />
      </>,
      {
        handlers: {
          'announcement.list': () => ({ items }),
          'announcement.delete': (input: unknown) => {
            const { announcementId } = input as { announcementId: string };
            items = items.filter((i) => i.announcementId !== announcementId);
            return { announcementId };
          },
        },
      },
    );
    const remove = async (title: string) => {
      await user.click(
        await screen.findByRole('button', { name: `Delete ${title}` }),
      );
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Delete announcement',
        }),
      );
    };
    await remove('Title 1');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Edit Title 2' }),
      ),
    );
    await remove('Title 2');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Announcements' }),
      ),
    );
  });
});
