/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { PreviewVideoArea } from './preview-video-area';

const { readVideoDuration } = vi.hoisted(() => ({
  readVideoDuration: vi.fn(),
}));
vi.mock('./read-video-duration', () => ({ readVideoDuration }));
// The player itself is covered in common-shadcn; here it only shows what it got.
vi.mock('@discava/common-shadcn/components/hls-video', async () => {
  const { captionMenuLabel } = await import(
    '@discava/common-shadcn/components/video-controls'
  );
  return {
    HlsVideo: ({
      url,
      captions = [],
    }: {
      url: string;
      captions?: { label: string; machineTranslated?: boolean }[];
    }) => (
      <div data-testid="player">
        {url}
        <ul>
          {captions.map((c) => (
            <li key={c.label}>{captionMenuLabel(c)}</li>
          ))}
        </ul>
      </div>
    ),
  };
});

// The PUT straight to S3 goes through XMLHttpRequest, for its progress.
let uploads: FakeUpload[] = [];
class FakeUpload {
  upload = {};
  onload?: () => void;
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
  readVideoDuration.mockResolvedValue(90);
});
afterEach(() => vi.unstubAllGlobals());

const COURSE_ID = 'course-1';
const summary = (overrides = {}) => ({
  status: 'ready' as const,
  durationSeconds: 90,
  hasPlayableVersion: true,
  submissionNonce: 'nonce-1',
  ...overrides,
});

const handlers = {
  'coursePreview.createUploadUrl': () => ({
    uploadUrl: 'https://upload.test/put',
    objectKey: 'courses/course-1/preview/uploads/a.mp4',
  }),
  'coursePreview.create': () => summary({ status: 'processing' }),
  'coursePreview.replace': () => summary({ status: 'processing' }),
  'coursePreview.remove': () => ({ removed: true }),
  'coursePreview.createVideoUrl': () => ({
    url: 'https://media.test/preview/master.m3u8',
    withCredentials: false,
    versionId: 'nonce-1',
    captions: [],
  }),
  'course.view': () => ({}),
};

const render = (props: Partial<Parameters<typeof PreviewVideoArea>[0]> = {}) =>
  renderWithInstructorApi(
    <PreviewVideoArea courseId={COURSE_ID} {...props} />,
    { handlers },
  );

const fileInput = () =>
  screen.getByLabelText('Preview video file') as HTMLInputElement;
const pick = (user: ReturnType<typeof render>['user']) =>
  user.upload(
    fileInput(),
    new File(['video'], 'intro.mp4', { type: 'video/mp4' }),
  );

describe('PreviewVideoArea', () => {
  it('shows the help text and a drop area when there is no preview', () => {
    render();

    expect(
      screen.getByText(
        'A short video that sells the course. At most 5 minutes; 1 to 2 minutes works best. Captions are added automatically.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Drop a video or click to browse')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Remove' }),
    ).not.toBeInTheDocument();
  });

  it('uploads a first preview with progress, then creates it', async () => {
    const { user, calls } = render();

    await pick(user);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(screen.getByText('Uploading… 0%')).toBeVisible();
    uploads[0].finish();

    await waitFor(() =>
      expect(calls.map((call) => call.path)).toContain('coursePreview.create'),
    );
    expect(
      calls.find((call) => call.path === 'coursePreview.create')?.input,
    ).toEqual({
      courseId: COURSE_ID,
      rawKey: 'courses/course-1/preview/uploads/a.mp4',
      durationSeconds: 90,
    });
  });

  it('refuses a file over 5 minutes before uploading it', async () => {
    readVideoDuration.mockResolvedValue(301);
    const { user, calls } = render();

    await pick(user);

    expect(
      await screen.findByText('This video is longer than 5 minutes'),
    ).toBeVisible();
    expect(calls).toEqual([]);
  });

  it('shows a processing state, and the previous version note when one plays', () => {
    render({
      preview: summary({ status: 'processing', hasPlayableVersion: false }),
    });
    expect(screen.getByText(/Processing video/)).toBeVisible();
    expect(screen.queryByText(/previous version/)).not.toBeInTheDocument();
  });

  it('keeps playing the previous version while a replacement processes', async () => {
    render({ preview: summary({ status: 'processing' }) });

    expect(screen.getByText(/Processing video/)).toBeVisible();
    expect(screen.getByText(/previous version/)).toBeVisible();
    expect(await screen.findByTestId('player')).toHaveTextContent(
      'https://media.test/preview/master.m3u8',
    );
  });

  it('shows the too-long message for a too-long failure', () => {
    render({
      preview: summary({
        status: 'failed',
        failureReason: 'too-long',
        hasPlayableVersion: false,
      }),
    });

    expect(
      screen.getByText(/This video is longer than 5 minutes/),
    ).toBeVisible();
  });

  it('shows a generic message for a transcode failure', () => {
    render({
      preview: summary({
        status: 'failed',
        failureReason: 'transcode-error',
        hasPlayableVersion: false,
      }),
    });

    expect(
      screen.getByText(/Something went wrong processing this video/),
    ).toBeVisible();
  });

  it('plays a ready preview through createVideoUrl and offers Replace and Remove', async () => {
    const { calls } = render({ preview: summary() });

    expect(await screen.findByTestId('player')).toBeVisible();
    expect(calls.map((call) => call.path)).toContain(
      'coursePreview.createVideoUrl',
    );
    expect(screen.getByRole('button', { name: 'Replace' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  it('passes a translated track to the player as auto-translated', async () => {
    renderWithInstructorApi(
      <PreviewVideoArea courseId={COURSE_ID} preview={summary()} />,
      {
        handlers: {
          ...handlers,
          'coursePreview.createVideoUrl': () => ({
            url: 'https://media.test/preview/master.m3u8',
            withCredentials: false,
            versionId: 'nonce-1',
            captions: [
              {
                trackId: 't2',
                language: 'es-ES',
                label: 'Español',
                isDefault: false,
                source: 'translated',
                machineTranslated: true,
                url: 'https://media.test/preview/t2.vtt',
              },
            ],
          }),
        },
      },
    );

    expect(await screen.findByText('Español (auto-translated)')).toBeVisible();
  });

  it('lists a language whose translation failed, read-only', async () => {
    renderWithInstructorApi(
      <PreviewVideoArea courseId={COURSE_ID} preview={summary()} />,
      {
        handlers: {
          ...handlers,
          'coursePreview.createVideoUrl': () => ({
            url: 'https://media.test/preview/master.m3u8',
            withCredentials: false,
            versionId: 'nonce-1',
            captions: [],
            translations: [
              {
                language: 'fr-FR',
                label: 'French',
                nativeLabel: 'Français',
                state: 'failed',
              },
            ],
          }),
        },
      },
    );

    expect(await screen.findByText('French: Translation failed')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Translate again' }),
    ).not.toBeInTheDocument();
  });

  it('replaces a preview, sending the nonce it read', async () => {
    const { user, calls } = render({ preview: summary() });

    await pick(user);
    await waitFor(() => expect(uploads).toHaveLength(1));
    uploads[0].finish();

    await waitFor(() =>
      expect(calls.map((call) => call.path)).toContain('coursePreview.replace'),
    );
    expect(
      calls.find((call) => call.path === 'coursePreview.replace')?.input,
    ).toMatchObject({ expectedSubmissionNonce: 'nonce-1' });
  });

  it('shows the API refusal of a replacement', async () => {
    const { user } = renderWithInstructorApi(
      <PreviewVideoArea courseId={COURSE_ID} preview={summary()} />,
      {
        handlers: {
          ...handlers,
          'coursePreview.replace': () => {
            throw new ApiError('CONFLICT', 'The preview changed; reload');
          },
        },
      },
    );

    await pick(user);
    await waitFor(() => expect(uploads).toHaveLength(1));
    uploads[0].finish();

    expect(
      await screen.findByText('The preview changed; reload'),
    ).toBeVisible();
  });

  it('asks before removing, and removes only on confirmation', async () => {
    const { user, calls } = render({ preview: summary() });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Remove the preview video',
    );
    expect(calls.map((call) => call.path)).not.toContain(
      'coursePreview.remove',
    );

    await user.click(screen.getByRole('button', { name: 'Remove video' }));

    await waitFor(() =>
      expect(
        calls.find((call) => call.path === 'coursePreview.remove')?.input,
      ).toEqual({ courseId: COURSE_ID, expectedSubmissionNonce: 'nonce-1' }),
    );
  });

  it('cancelling the confirmation removes nothing', async () => {
    const { user, calls } = render({ preview: summary() });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(calls.map((call) => call.path)).not.toContain(
      'coursePreview.remove',
    );
  });

  it('offers no upload, Replace or Remove when read-only', () => {
    render({ preview: summary(), readOnly: true });

    expect(
      screen.queryByRole('button', { name: 'Replace' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove' }),
    ).not.toBeInTheDocument();
  });

  it('asks for the video again when a replacement becomes ready', async () => {
    const Harness = () => {
      const [ready, setReady] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setReady(true)}>
            Finish
          </button>
          <PreviewVideoArea
            courseId={COURSE_ID}
            preview={summary({ status: ready ? 'ready' : 'processing' })}
          />
        </>
      );
    };
    const { calls, user } = renderWithInstructorApi(<Harness />, { handlers });
    const urlCalls = () =>
      calls.filter((call) => call.path === 'coursePreview.createVideoUrl');
    await waitFor(() => expect(urlCalls()).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(urlCalls()).toHaveLength(2));
  });
});
