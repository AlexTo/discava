/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { AssignmentItem } from './assignment-item';
import type { PlayerItem } from './use-course-player';

const AT = '2026-10-01T00:00:00.000Z';
const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const assignment = (overrides: Record<string, unknown> = {}) =>
  ({
    courseId: 'course-1',
    moduleId: 'module-1',
    lessonId: 'lesson-1',
    contentItemId: 'item-1',
    type: 'assignment',
    status: 'ready',
    title: 'Essay',
    order: 1,
    body: doc('Write 500 words'),
    maxPoints: 20,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }) as Extract<PlayerItem, { type: 'assignment' }>;

const submission = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  status: 'submitted',
  submittedAt: '2026-11-14T10:30:00.000Z',
  late: false,
  file: { fileName: 'essay.pdf', fileSize: 2048, mimeType: 'application/pdf' },
  ...overrides,
});

const target = {
  objectKey: 'courses/course-1/submissions/student-1/up-1/essay.pdf',
  uploadUrl: 'https://upload.test/put',
  headers: { 'Content-Type': 'application/pdf' },
};

const render = ({
  item = assignment(),
  done = false,
  readOnly = false,
  handlers = {},
  upload = vi.fn(async () => {}),
}: {
  item?: ReturnType<typeof assignment>;
  done?: boolean;
  readOnly?: boolean;
  handlers?: Record<string, Handler>;
  upload?: (...args: any[]) => Promise<void>;
} = {}) =>
  renderWithCoreApi(
    <AssignmentItem
      item={item}
      done={done}
      readOnly={readOnly}
      upload={upload as never}
    />,
    {
      handlers: {
        'assignment.uploadUrl': () => target,
        'assignment.submit': () => submission(),
        'course.myItemCompletions': () => ({ items: [] }),
        'course.myLessonProgress': () => ({ lessons: [] }),
        'course.myEnrolment': () => ({}),
        ...handlers,
      },
    },
  );

const pdf = (name = 'essay.pdf', bytes = 2048) =>
  new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });

const choose = async (user: ReturnType<typeof render>['user'], file: File) =>
  user.upload(await screen.findByLabelText('Choose file'), file);

const submitButton = () => screen.getByRole('button', { name: /^Submit/ });

describe('AssignmentItem', () => {
  it('shows the instructions, due date, points and limits', async () => {
    render({ item: assignment({ dueAt: '2099-01-01T00:00:00.000Z' }) });

    expect(await screen.findByText('Write 500 words')).toBeInTheDocument();
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('Maximum points')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(
      screen.getByText(/One file, up to 100 MB. Allowed: \.pdf, \.docx/),
    ).toBeInTheDocument();
  });

  it('offers an empty picker and a disabled Submit with no submission', async () => {
    render();

    expect(
      await screen.findByRole('button', { name: 'Choose file' }),
    ).toBeEnabled();
    expect(submitButton()).toBeDisabled();
  });

  it('shows the chosen file and enables Submit, and lets it be removed', async () => {
    const { user } = render();

    await choose(user, pdf('essay.pdf', 2048));

    expect(await screen.findByText(/essay\.pdf \(2 KB\)/)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Remove essay.pdf' }));
    expect(screen.queryByText(/essay\.pdf \(2 KB\)/)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('replaces the chosen file when another is chosen', async () => {
    const { user } = render();

    await choose(user, pdf('first.pdf'));
    await choose(user, pdf('second.pdf'));

    expect(await screen.findByText(/second\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/first\.pdf/)).not.toBeInTheDocument();
  });

  describe('refuses before anything is uploaded', () => {
    it('a file that is over 100 MB', async () => {
      const upload = vi.fn();
      const { user, calls } = render({ upload });
      const big = pdf('huge.pdf', 1);
      Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });

      await choose(user, big);

      expect(await screen.findByText('huge.pdf is over 100 MB')).toBeVisible();
      expect(submitButton()).toBeDisabled();
      expect(upload).not.toHaveBeenCalled();
      expect(calls.filter((c) => c.path.startsWith('assignment'))).toEqual([]);
    });

    it('a file of a type that is not allowed', async () => {
      render();

      // The picker's own `accept` hides such files from most dialogs, but
      // nothing stops one being dropped or chosen with "All files".
      fireEvent.change(await screen.findByLabelText('Choose file'), {
        target: { files: [new File(['x'], 'run.exe')] },
      });

      expect(
        await screen.findByText("run.exe can't be attached (type)"),
      ).toBeVisible();
      expect(submitButton()).toBeDisabled();
    });
  });

  it('uploads with progress, then submits and confirms', async () => {
    let finishUpload: () => void = () => {};
    const upload = vi.fn(
      (_url: string, _headers: unknown, _file: File, onProgress) => {
        onProgress(40);
        return new Promise<void>((resolve) => {
          finishUpload = resolve;
        });
      },
    );
    const { user, calls } = render({ upload });
    await choose(user, pdf());

    await user.click(submitButton());

    expect(await screen.findByText('Uploading essay.pdf…')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-label',
      'Uploading, 40%',
    );
    // Nothing can be changed while it uploads.
    expect(
      screen.getByRole('button', { name: 'Remove essay.pdf' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeDisabled();
    expect(upload).toHaveBeenCalledWith(
      target.uploadUrl,
      target.headers,
      expect.any(File),
      expect.any(Function),
    );

    finishUpload();

    expect(await screen.findByText(/^Submitted/)).toBeVisible();
    expect(screen.getByText('Version 1')).toBeVisible();
    expect(screen.queryByText('Late')).not.toBeInTheDocument();
    expect(screen.getByText('essay.pdf')).toBeVisible();
    expect(calls.find((c) => c.path === 'assignment.uploadUrl')?.input).toEqual(
      {
        courseId: 'course-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
        contentItemId: 'item-1',
        fileName: 'essay.pdf',
        fileSize: 2048,
      },
    );
    expect(calls.find((c) => c.path === 'assignment.submit')?.input).toEqual({
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      contentItemId: 'item-1',
      objectKey: target.objectKey,
      fileName: 'essay.pdf',
    });
  });

  it('shows a busy Submit while the submission is recorded', async () => {
    let finish: (value: unknown) => void = () => {};
    const { user } = render({
      handlers: {
        'assignment.submit': () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    await choose(user, pdf());

    await user.click(submitButton());

    expect(await screen.findByText('Submitting your work…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    finish(submission());
    expect(await screen.findByText(/^Submitted/)).toBeVisible();
  });

  it('adds the Late notice when core-api says the work is late', async () => {
    const { user } = render({
      handlers: { 'assignment.submit': () => submission({ late: true }) },
    });
    await choose(user, pdf());

    await user.click(submitButton());

    expect(await screen.findByText('Late')).toBeVisible();
  });

  it('notes a past due date, accepting late work', async () => {
    render({ item: assignment({ dueAt: '2020-01-01T00:00:00.000Z' }) });

    expect(
      await screen.findByText(
        'This assignment is past due. Late work is accepted and marked late.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeEnabled();
  });

  it('does not call a future due date past due', async () => {
    render({ item: assignment({ dueAt: '2099-01-01T00:00:00.000Z' }) });

    await screen.findByText('Write 500 words');
    expect(screen.queryByText(/past due/)).not.toBeInTheDocument();
  });

  it('says so on a conflict, keeping the file, and tries again', async () => {
    let attempts = 0;
    const { user } = render({
      handlers: {
        'assignment.submit': () => {
          if (attempts++ === 0) {
            throw new ApiError('CONFLICT', 'conflict');
          }
          return submission();
        },
      },
    });
    await choose(user, pdf());
    await user.click(submitButton());

    expect(
      await screen.findByText(
        'Your submission changed while you were sending it. Try again',
      ),
    ).toBeVisible();
    expect(screen.getByText(/essay\.pdf \(2 KB\)/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/^Submitted/)).toBeVisible();
  });

  it('says nothing was submitted when the upload fails', async () => {
    const upload = vi.fn(async () => {
      throw new Error('Failed to upload the file');
    });
    const { user, calls } = render({ upload });
    await choose(user, pdf());

    await user.click(submitButton());

    expect(
      await screen.findByText(
        'Something went wrong and your work was not submitted',
      ),
    ).toBeVisible();
    expect(calls.some((c) => c.path === 'assignment.submit')).toBe(false);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('shows the server’s reason when it refuses', async () => {
    const { user } = render({
      handlers: {
        'assignment.submit': () => {
          throw new ApiError(
            'PRECONDITION_FAILED',
            "This submission has been returned and can't be changed",
          );
        },
      },
    });
    await choose(user, pdf());
    await user.click(submitButton());

    expect(
      await screen.findByText(
        "This submission has been returned and can't be changed",
      ),
    ).toBeVisible();
  });

  it('is unavailable when the assignment was hidden meanwhile', async () => {
    const { user, queryClient } = render({
      handlers: {
        'assignment.uploadUrl': () => {
          throw new ApiError('NOT_FOUND', 'This assignment is not available');
        },
      },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await choose(user, pdf());
    await user.click(submitButton());

    expect(
      await screen.findByText('This assignment is no longer available.'),
    ).toBeVisible();
    // The curriculum is read again, so the page shows what's there now.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        ['course', 'view'],
        { input: { courseId: 'course-1' }, type: 'query' },
      ],
    });
    expect(
      screen.getByRole('button', { name: /^(Submit|Try again)/ }),
    ).toBeDisabled();
  });

  it('offers no submit in an archived course', async () => {
    render({ readOnly: true });

    expect(await screen.findByText('This course is archived')).toBeVisible();
    expect(screen.queryByLabelText('Choose file')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();
    // The details are still there.
    expect(screen.getByText('Write 500 words')).toBeVisible();
  });

  it('says the work was submitted when the item is already done', async () => {
    render({ done: true });

    expect(
      await screen.findByText(
        "You've submitted your work for this assignment.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();
  });
});
