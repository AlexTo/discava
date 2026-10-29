/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import {
  AttachLessonVideoDialog,
  RemoveLessonVideoButton,
} from './attach-lesson-video-dialog';

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

// The dialog's content portals to document.body (Radix Dialog), outside the
// render()ed container, so the hidden file input is found from the document.
const fileInput = () =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

const pickFile = async (
  user: ReturnType<typeof renderWithInstructorApi>['user'],
) => {
  await user.upload(
    fileInput(),
    new File(['video'], 'lecture.mp4', { type: 'video/mp4' }),
  );
  await waitFor(() => expect(uploads).toHaveLength(1));
};

const title = () => screen.getByLabelText('Title');

describe('AttachLessonVideoDialog', () => {
  describe('adding a new video', () => {
    const openDialog = () =>
      renderWithInstructorApi(
        <AttachLessonVideoDialog
          {...lesson}
          trigger={<Button type="button">Video</Button>}
        />,
        {
          handlers: {
            'contentItem.createVideoUploadUrl': () => ({
              contentItemId: 'item-1',
              uploadUrl: 'https://upload.example.com/put',
              objectKey: 'uploads/item-1/lecture.mp4',
            }),
            'contentItem.createVideo': () => ({}),
          },
        },
      );

    it('titles the dialog "Add video" and disables Save until uploaded and titled', async () => {
      const { user } = openDialog();

      await user.click(screen.getByRole('button', { name: 'Video' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Add video');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      await pickFile(user);
      uploads[0].finish();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      await user.type(title(), 'Lecture 1');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('shows upload progress while uploading, and the uploaded state once done', async () => {
      const { user } = openDialog();

      await user.click(screen.getByRole('button', { name: 'Video' }));
      await pickFile(user);

      act(() => {
        uploads[0].upload.onprogress?.({
          lengthComputable: true,
          loaded: 50,
          total: 100,
        } as ProgressEvent);
      });
      expect(screen.getByLabelText('Upload progress')).toBeInTheDocument();
      expect(screen.getByText('Uploading... 50%')).toBeInTheDocument();

      uploads[0].finish();
      await waitFor(() =>
        expect(
          screen.getByText('Video uploaded — click Save to attach it'),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByLabelText('Upload progress')).toBeNull();
    });

    it('creates the video item with the uploaded file, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = openDialog();
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Video' }));
      await pickFile(user);
      uploads[0].finish();
      await user.type(title(), 'Lecture 1');
      await user.type(screen.getByLabelText('Description'), 'Welcome lecture');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(calls).toEqual([
        {
          path: 'contentItem.createVideoUploadUrl',
          input: {
            courseId: 'course-1',
            moduleId: 'module-1',
            lessonId: 'l1',
            fileName: 'lecture.mp4',
          },
        },
        {
          path: 'contentItem.createVideo',
          input: {
            courseId: 'course-1',
            moduleId: 'module-1',
            lessonId: 'l1',
            contentItemId: 'item-1',
            objectKey: 'uploads/item-1/lecture.mp4',
            mimeType: 'video/mp4',
            title: 'Lecture 1',
            description: 'Welcome lecture',
          },
        },
      ]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: 'course-1' }),
      });
    });

    it('shows a refusal from the API when saving, and the dialog stays open', async () => {
      const { user } = renderWithInstructorApi(
        <AttachLessonVideoDialog
          {...lesson}
          trigger={<Button type="button">Video</Button>}
        />,
        {
          handlers: {
            'contentItem.createVideoUploadUrl': () => ({
              contentItemId: 'item-1',
              uploadUrl: 'https://upload.example.com/put',
              objectKey: 'uploads/item-1/lecture.mp4',
            }),
            'contentItem.createVideo': () => {
              throw new ApiError('BAD_REQUEST', 'Title is required');
            },
          },
        },
      );

      await user.click(screen.getByRole('button', { name: 'Video' }));
      await pickFile(user);
      uploads[0].finish();
      await user.type(title(), 'Lecture 1');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      const dialog = await screen.findByText("Couldn't save the video");
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText('Title is required')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('editing an existing video', () => {
    it('plays the current video and lets the title and description be changed', async () => {
      // Native HLS playback (as Safari supports), so the player sets `src`
      // without needing hls.js, which jsdom can't run (no MediaSource).
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue(
        'probably',
      );
      const { user } = renderWithInstructorApi(
        <AttachLessonVideoDialog
          {...lesson}
          contentItemId="item-1"
          title="Lecture 1"
          description="Welcome"
          status="ready"
          trigger={<Button type="button">Edit</Button>}
        />,
        {
          handlers: {
            'contentItem.createVideoUrl': () => ({
              url: 'https://media.test/item-1/master.m3u8',
              withCredentials: true,
            }),
          },
        },
      );

      await user.click(screen.getByRole('button', { name: 'Edit' }));

      expect(screen.getByRole('dialog')).toHaveTextContent('Edit video');
      expect(title()).toHaveValue('Lecture 1');
      await waitFor(() =>
        expect(document.querySelector('video')?.src).toBe(
          'https://media.test/item-1/master.m3u8',
        ),
      );
    });

    it('shows a spinner and a note while the video is processing', async () => {
      const { user } = renderWithInstructorApi(
        <AttachLessonVideoDialog
          {...lesson}
          contentItemId="item-1"
          title="Lecture 1"
          status="pending"
          hasPreviousVersion
          trigger={<Button type="button">Edit</Button>}
        />,
        { handlers: { 'course.view': () => ({ modules: [] }) } },
      );

      await user.click(screen.getByRole('button', { name: 'Edit' }));

      expect(screen.getByText(/Processing video/)).toBeInTheDocument();
      expect(
        screen.getByText(
          'Students still see the previous version until this one is ready.',
        ),
      ).toBeInTheDocument();
    });

    it('explains a failed transcode and invites a new upload', async () => {
      const { user } = renderWithInstructorApi(
        <AttachLessonVideoDialog
          {...lesson}
          contentItemId="item-1"
          title="Lecture 1"
          status="failed"
          trigger={<Button type="button">Edit</Button>}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Edit' }));

      expect(screen.getByText('Video processing failed')).toBeInTheDocument();
      expect(
        screen.getByText(/Drop a new file below to retry/),
      ).toBeInTheDocument();
    });

    it('replaces the video, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } =
        renderWithInstructorApi(
          <AttachLessonVideoDialog
            {...lesson}
            contentItemId="item-1"
            title="Lecture 1"
            description="Welcome"
            status="ready"
            trigger={<Button type="button">Edit</Button>}
          />,
          {
            handlers: {
              'contentItem.createVideoUrl': () => ({
                url: 'https://media.test/item-1/master.m3u8',
                withCredentials: true,
              }),
              'contentItem.createVideoUploadUrl': () => ({
                contentItemId: 'item-1',
                uploadUrl: 'https://upload.example.com/put',
                objectKey: 'uploads/item-1/lecture-2.mp4',
              }),
              'contentItem.updateVideo': () => ({}),
            },
          },
        );
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await pickFile(user);
      uploads[0].finish();
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(calls).toContainEqual({
        path: 'contentItem.createVideoUploadUrl',
        input: {
          courseId: 'course-1',
          moduleId: 'module-1',
          lessonId: 'l1',
          fileName: 'lecture.mp4',
          contentItemId: 'item-1',
        },
      });
      expect(calls).toContainEqual({
        path: 'contentItem.updateVideo',
        input: {
          courseId: 'course-1',
          moduleId: 'module-1',
          lessonId: 'l1',
          contentItemId: 'item-1',
          title: 'Lecture 1',
          description: 'Welcome',
          objectKey: 'uploads/item-1/lecture-2.mp4',
          mimeType: 'video/mp4',
        },
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: 'course-1' }),
      });
    });
  });
});

describe('RemoveLessonVideoButton', () => {
  const renderButton = (
    props: Partial<Parameters<typeof RemoveLessonVideoButton>[0]> = {},
    handlers = {},
  ) =>
    renderWithInstructorApi(
      <RemoveLessonVideoButton
        {...lesson}
        contentItemId="item-1"
        title="Lecture 1"
        archive={false}
        {...props}
      />,
      { handlers },
    );

  it('warns that this cannot be undone, and Cancel removes nothing', async () => {
    const { calls, user } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Remove Lecture 1' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Are you sure you want to remove "Lecture 1"? This can\'t be undone.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('removes the video, closes, and refreshes the course view', async () => {
    const { calls, queryClient, optionsProxy, user } = renderButton(
      {},
      { 'contentItem.delete': () => undefined },
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'Remove Lecture 1' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Remove video',
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      {
        path: 'contentItem.delete',
        input: { ...lesson, contentItemId: 'item-1' },
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: optionsProxy.course.view.queryKey({ courseId: 'course-1' }),
    });
  });

  it('explains that students keep their progress, warns if they used it, and archives on confirm', async () => {
    const { calls, user } = renderButton(
      { archive: true, students: 5 },
      { 'contentItem.delete': () => undefined },
    );

    await user.click(screen.getByRole('button', { name: 'Remove Lecture 1' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Students will no longer see "Lecture 1"');
    expect(dialog).toHaveTextContent('5 students have used it');

    await user.click(
      within(dialog).getByRole('button', { name: 'Archive video' }),
    );

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'contentItem.delete',
          input: { ...lesson, contentItemId: 'item-1' },
        },
      ]),
    );
  });

  it('shows the error when removing fails, and the dialog stays open', async () => {
    const { user } = renderButton(
      {},
      {
        'contentItem.delete': () => {
          throw new ApiError('CONFLICT', 'The video was modified');
        },
      },
    );

    await user.click(screen.getByRole('button', { name: 'Remove Lecture 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove video' }));

    expect(
      await screen.findByText("Couldn't remove the video"),
    ).toBeInTheDocument();
    expect(screen.getByText('The video was modified')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
