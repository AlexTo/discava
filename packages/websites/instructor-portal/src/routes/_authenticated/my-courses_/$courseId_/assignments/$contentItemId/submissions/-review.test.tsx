/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../../test/render-with-instructor-api';

// The breadcrumb needs the portal shell's router and context.
vi.mock('@discava/common-shadcn/components/breadcrumb-label', () => ({
  useBreadcrumbLabel: () => {},
}));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    // A real Link needs a router; render the target it would link to.
    Link: ({
      to,
      params,
      children,
      ...props
    }: {
      to: string;
      params: Record<string, string>;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={Object.entries(params).reduce(
          (path, [key, value]) => path.replace(`$${key}`, value),
          to,
        )}
        {...props}
      >
        {children}
      </a>
    ),
  });
});
vi.mock('./-components/file-preview', () => ({
  FilePreview: ({ file }: { file: { fileName: string } }) => (
    <div>Preview of {file.fileName}</div>
  ),
}));

const { Route } = await import('./$userId');
const RouteComponent = Route.options.component!;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Route, 'useParams').mockReturnValue({
    courseId: 'c1',
    contentItemId: 'i1',
    userId: 'u1',
  });
});

const submission = (extra = {}) => ({
  state: 'submitted',
  version: 2,
  reviewRevision: 5,
  submittedAt: '2026-11-01T10:00:00.000Z',
  late: false,
  file: {
    fileName: 'essay.pdf',
    fileSize: 100,
    mimeType: 'application/pdf',
    previewable: 'pdf',
  },
  ...extra,
});

const view = (over: Record<string, unknown> = {}) => ({
  assignment: { title: 'Essay', maxPoints: 20 },
  student: { userId: 'u1', displayName: 'Sam Student', enrolled: true },
  submission: submission(),
  feedback: [],
  ...over,
});

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const render = (
  get: () => unknown,
  handlers: Record<string, never> | object = {},
) =>
  renderWithInstructorApi(<RouteComponent />, {
    handlers: { 'assignmentSubmission.get': get, ...handlers },
  });

describe('Review page', () => {
  it('shows the student, the preview, the details and the history', async () => {
    render(() =>
      view({
        feedback: [
          {
            feedbackId: 'f1',
            kind: 'resubmission_requested',
            feedback: doc('Add sources'),
            version: 1,
            givenAt: '2026-10-30T10:00:00.000Z',
            givenBy: { userId: 'i', displayName: 'Ines' },
          },
        ],
      }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Sam Student' }),
    ).toBeVisible();
    expect(screen.getByText('Preview of essay.pdf')).toBeVisible();
    expect(screen.getByText('Version 2')).toBeVisible();
    expect(screen.getByText('Add sources')).toBeVisible();
    expect(screen.getByText(/by Ines/)).toBeVisible();
  });

  it('returns with the version and revision it rendered, then clears the draft', async () => {
    const { calls, user } = render(() => view(), {
      'assignmentSubmission.return': () => ({ reviewRevision: 6 }),
    });

    await user.type(await screen.findByLabelText('Points'), '17');
    await user.type(screen.getByLabelText('Feedback'), 'Well done');
    await user.click(screen.getByRole('button', { name: 'Return' }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.path === 'assignmentSubmission.return'),
      ).toBeDefined(),
    );
    const sent = calls.find((c) => c.path === 'assignmentSubmission.return')!;
    expect(sent.input).toMatchObject({
      courseId: 'c1',
      contentItemId: 'i1',
      userId: 'u1',
      version: 2,
      reviewRevision: 5,
      points: 17,
    });
    expect((sent.input as { feedback: string }).feedback).toContain(
      'Well done',
    );
    await waitFor(() =>
      expect(localStorage.getItem('discava:grading-draft:c1:i1:u1')).toBeNull(),
    );
    // The draft is saved after a short delay: it must not come back.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(localStorage.getItem('discava:grading-draft:c1:i1:u1')).toBeNull();
  });

  it('refuses points over the maximum before sending', async () => {
    const { calls, user } = render(() => view());

    await user.type(await screen.findByLabelText('Points'), '25');
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Points must be between 0 and 20',
    );
    expect(calls.some((c) => c.path === 'assignmentSubmission.return')).toBe(
      false,
    );
  });

  it('amends a returned grade through Edit grade', async () => {
    const { calls, user } = render(
      () =>
        view({
          submission: submission({
            state: 'returned',
            points: 17,
            pointsOutOf: 20,
          }),
        }),
      { 'assignmentSubmission.amendGrade': () => ({ reviewRevision: 6 }) },
    );

    expect(await screen.findByText(/Returned: 17 \/ 20/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Request resubmission' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit grade' }));
    const points = screen.getByLabelText('Points');
    await user.clear(points);
    await user.type(points, '18');
    await user.click(screen.getByRole('button', { name: 'Save grade' }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.path === 'assignmentSubmission.amendGrade'),
      ).toBeDefined(),
    );
    expect(
      calls.find((c) => c.path === 'assignmentSubmission.amendGrade')!.input,
    ).toMatchObject({ reviewRevision: 5, points: 18 });
  });

  it('replaces the form with a notice for a student who left', async () => {
    render(() =>
      view({
        student: { userId: 'u1', displayName: 'Sam Student', enrolled: false },
      }),
    );

    expect(
      await screen.findByText(
        'This student has left the course. Their work can be read but not graded.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();
    expect(screen.getByText('Preview of essay.pdf')).toBeVisible();
  });

  it('restores an unsent draft after a remount', async () => {
    localStorage.setItem(
      'discava:grading-draft:c1:i1:u1',
      JSON.stringify({ points: '12', feedback: doc('Half done') }),
    );
    render(() => view());

    expect(await screen.findByLabelText('Points')).toHaveValue(12);
    expect(screen.getByLabelText('Feedback')).toHaveTextContent('Half done');
  });

  it('saves what is typed as a draft', async () => {
    const { user } = render(() => view());

    await user.type(await screen.findByLabelText('Points'), '9');

    await waitFor(() =>
      expect(
        JSON.parse(
          localStorage.getItem('discava:grading-draft:c1:i1:u1') ?? '{}',
        ),
      ).toMatchObject({ points: '9' }),
    );
  });

  it('keeps the draft and shows the message on a conflict', async () => {
    let gets = 0;
    const { user } = render(
      () => {
        gets += 1;
        return view();
      },
      {
        'assignmentSubmission.return': () => {
          throw new ApiError(
            'CONFLICT',
            'Another instructor already returned this',
          );
        },
      },
    );

    await user.type(await screen.findByLabelText('Points'), '15');
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another instructor already returned this',
    );
    await waitFor(() => expect(gets).toBeGreaterThan(1));
    expect(screen.getByLabelText('Points')).toHaveValue(15);
    await waitFor(() =>
      expect(
        localStorage.getItem('discava:grading-draft:c1:i1:u1'),
      ).not.toBeNull(),
    );
  });

  describe('Request resubmission', () => {
    it('is disabled until the feedback has text, then sends it', async () => {
      const { calls, user } = render(() => view(), {
        'assignmentSubmission.requestResubmission': () => ({
          reviewRevision: 6,
        }),
      });

      const request = await screen.findByRole('button', {
        name: 'Request resubmission',
      });
      expect(request).toBeDisabled();
      await user.type(screen.getByLabelText('Feedback'), 'Add sources');
      expect(request).toBeEnabled();
      await user.click(request);

      await waitFor(() =>
        expect(
          calls.find(
            (c) => c.path === 'assignmentSubmission.requestResubmission',
          ),
        ).toBeDefined(),
      );
      const sent = calls.find(
        (c) => c.path === 'assignmentSubmission.requestResubmission',
      )!;
      expect(sent.input).toMatchObject({ version: 2, reviewRevision: 5 });
      expect((sent.input as { feedback: string }).feedback).toContain(
        'Add sources',
      );
    });

    it('is hidden once a resubmission is requested', async () => {
      render(() =>
        view({ submission: submission({ state: 'resubmission_requested' }) }),
      );

      expect(
        await screen.findByRole('button', { name: 'Return' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Request resubmission' }),
      ).toBeNull();
    });
  });
});
