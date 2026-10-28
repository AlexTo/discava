/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithInstructorApi } from '../../../../../../test/render-with-instructor-api';
import { AttachLessonFileDialog } from './attach-lesson-file-dialog';

const lesson = { courseId: 'course-1', moduleId: 'module-1', lessonId: 'l1' };

// The PUT straight to S3 goes through XMLHttpRequest, for its progress. Each
// upload waits until the test finishes it.
let uploads: FakeUpload[] = [];
class FakeUpload {
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  status = 0;
  open() {}
  setRequestHeader() {}
  send() {
    uploads.push(this);
  }
  finish() {
    this.status = 200;
    this.onload?.();
  }
}

beforeEach(() => {
  uploads = [];
  vi.stubGlobal('XMLHttpRequest', FakeUpload);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const openDialog = () => {
  const rendered = renderWithInstructorApi(
    <AttachLessonFileDialog
      {...lesson}
      trigger={<Button type="button">File</Button>}
    />,
    {
      handlers: {
        'contentItem.createFileUploadUrl': () => ({
          contentItemId: 'item-1',
          uploadUrl: 'https://upload.example.com/put',
          headers: {},
          objectKey: 'uploads/item-1/worksheet.pdf',
        }),
        'contentItem.createFile': () => ({}),
      },
    },
  );
  return rendered;
};

const pickFile = async (
  user: ReturnType<typeof renderWithInstructorApi>['user'],
) => {
  await user.click(screen.getByRole('button', { name: 'File' }));
  await user.upload(
    screen.getByLabelText('File to attach'),
    new File(['%PDF'], 'worksheet.pdf', { type: 'application/pdf' }),
  );
  await waitFor(() => expect(uploads).toHaveLength(1));
};

const title = () => screen.getByLabelText('Title');

describe('AttachLessonFileDialog', () => {
  it('starts the title from the file’s name, once uploaded', async () => {
    const { user } = openDialog();

    await pickFile(user);
    uploads[0].finish();

    await waitFor(() => expect(title()).toHaveValue('worksheet'));
  });

  it('keeps a title typed while the file uploads', async () => {
    const { user, calls } = openDialog();

    await pickFile(user);
    await user.type(title(), 'Worksheet one');
    uploads[0].finish();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    expect(title()).toHaveValue('Worksheet one');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'contentItem.createFile',
        input: expect.objectContaining({ title: 'Worksheet one' }),
      }),
    );
  });

  // Invariant: once the instructor types in the title, the upload finishing
  // never changes it (#256). Typing over a title empties the field for a
  // moment; the name used to be filled in then, landing among the keystrokes.
  it('leaves a title being typed alone, even while it is empty', async () => {
    const { user } = openDialog();

    await pickFile(user);
    await user.type(title(), 'W');
    await user.clear(title());
    uploads[0].finish();

    await waitFor(() =>
      expect(screen.queryByLabelText('Upload progress')).toBeNull(),
    );
    expect(title()).toHaveValue('');
  });
});
