/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { VideoCaptionsDialog } from './video-captions-dialog';

const keys = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};

const auto = {
  trackId: 't-auto',
  language: 'en-US',
  label: 'English',
  isDefault: true,
  source: 'auto' as const,
  url: 'https://media.test/auto.vtt',
};
const uploaded = {
  trackId: 't-es',
  language: 'es-ES',
  label: 'Spanish',
  isDefault: false,
  source: 'uploaded' as const,
  url: 'https://media.test/es.vtt',
};

const translated = {
  trackId: 't-fr',
  language: 'fr-FR',
  label: 'Français',
  isDefault: false,
  source: 'translated' as const,
  url: 'https://media.test/fr.vtt',
};

type Translation = {
  language: string;
  label: string;
  nativeLabel: string;
  state: string;
  reason?: string;
};

const videoUrl = (
  captions = [auto, uploaded],
  captionsStatus = 'ready',
  translations: Translation[] = [],
) => ({
  url: 'https://media.test/master.m3u8',
  withCredentials: false,
  versionId: 'v1',
  captionsStatus,
  captions,
  translations,
});

const row = (
  state: string,
  reason?: string,
  language = 'de-DE',
): Translation => ({
  language,
  label: 'German',
  nativeLabel: 'Deutsch',
  state,
  reason,
});

const vttFile = (name = 'spanish.vtt') =>
  new File(['WEBVTT\n\n00:00.000 --> 00:01.000\nHola\n'], name, {
    type: 'text/vtt',
  });

const renderDialog = (handlers: Record<string, (input: unknown) => unknown>) =>
  renderWithInstructorApi(
    <VideoCaptionsDialog
      {...keys}
      title="Intro video"
      trigger={<button type="button">Captions</button>}
    />,
    {
      handlers: { 'contentItem.createVideoUrl': () => videoUrl(), ...handlers },
    },
  );

const open = async (rendered: ReturnType<typeof renderDialog>) => {
  await rendered.user.click(screen.getByRole('button', { name: 'Captions' }));
  return screen.findByRole('dialog', { name: /captions/i });
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VideoCaptionsDialog', () => {
  it('lists the tracks with label, language, source and the default', async () => {
    const rendered = renderDialog({});
    const dialog = await open(rendered);

    const english = await within(dialog).findByRole('listitem', {
      name: 'English',
    });
    expect(within(english).getByText('en-US')).toBeInTheDocument();
    expect(within(english).getByText('Automatic')).toBeInTheDocument();
    expect(within(english).getByText('Default')).toBeInTheDocument();

    const spanish = within(dialog).getByRole('listitem', { name: 'Spanish' });
    expect(within(spanish).getByText('es-ES')).toBeInTheDocument();
    expect(within(spanish).getByText('Uploaded')).toBeInTheDocument();
    expect(within(spanish).queryByText('Default')).toBeNull();
  });

  it('marks a translated track, offers no Remove for it and explains where it comes from', async () => {
    const rendered = renderDialog({
      'contentItem.createVideoUrl': () =>
        videoUrl([auto, uploaded, translated]),
    });
    const dialog = await open(rendered);

    const french = await within(dialog).findByRole('listitem', {
      name: 'Français',
    });
    expect(within(french).getByText('Auto-translated')).toBeInTheDocument();
    expect(
      within(french).getByText("From the course's caption languages"),
    ).toBeInTheDocument();
    expect(
      within(french).queryByRole('button', { name: /remove/i }),
    ).toBeNull();
    // Other tracks keep theirs.
    expect(
      within(dialog).getByRole('button', { name: 'Remove Spanish' }),
    ).toBeInTheDocument();
  });

  it('says that a video can have auto-translated tracks among its ten', async () => {
    const rendered = renderDialog({});
    const dialog = await open(rendered);

    expect(
      within(dialog).getByText(
        /up to 10 tracks, one per language, including auto-translated ones\./,
      ),
    ).toBeInTheDocument();
  });

  it('says so when there are no tracks', async () => {
    const rendered = renderDialog({
      'contentItem.createVideoUrl': () => videoUrl([], 'failed'),
    });
    const dialog = await open(rendered);

    expect(await within(dialog).findByText('No captions yet.')).toBeVisible();
  });

  it('uploads a .vtt for the chosen language, then attaches it', async () => {
    const attach = vi.fn(() => ({ captions: [] }));
    const rendered = renderDialog({
      'contentItem.captionUploadUrl': () => ({
        uploadId: 'up-1',
        url: 'https://upload.test/put',
        headers: { 'Content-Type': 'text/vtt' },
      }),
      'contentItem.attachCaption': attach,
    });
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    await rendered.user.selectOptions(
      within(dialog).getByLabelText('Language'),
      'fr-FR',
    );
    fireEvent.change(within(dialog).getByLabelText('Caption file (.vtt)'), {
      target: { files: [vttFile('french.vtt')] },
    });
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Upload caption' }),
    );

    await waitFor(() => expect(attach).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.test/put',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'text/vtt' },
      }),
    );
    expect(rendered.calls.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'contentItem.captionUploadUrl',
        'contentItem.attachCaption',
      ]),
    );
    expect(attach).toHaveBeenCalledWith({
      ...keys,
      uploadId: 'up-1',
      language: 'fr-FR',
    });
    // The list is read again afterwards.
    await waitFor(() =>
      expect(
        rendered.calls.filter(
          ({ path }) => path === 'contentItem.createVideoUrl',
        ).length,
      ).toBeGreaterThan(1),
    );
  });

  it('opens on the Language select', async () => {
    const rendered = renderDialog({});
    const dialog = await open(rendered);

    await waitFor(() =>
      expect(within(dialog).getByLabelText('Language')).toHaveFocus(),
    );
  });

  it('announces the added captions and focuses the new track', async () => {
    let tracks: Array<typeof auto | typeof uploaded> = [auto];
    const rendered = renderDialog({
      'contentItem.captionUploadUrl': () => ({
        uploadId: 'up-1',
        url: 'https://upload.test/put',
        headers: {},
      }),
      'contentItem.attachCaption': () => {
        tracks = [
          auto,
          { ...uploaded, trackId: 't-fr', language: 'fr-FR', label: 'French' },
        ];
        return { captions: tracks };
      },
      'contentItem.createVideoUrl': () => videoUrl(tracks),
    });
    const dialog = await open(rendered);
    await rendered.user.selectOptions(
      within(dialog).getByLabelText('Language'),
      'fr-FR',
    );
    fireEvent.change(within(dialog).getByLabelText('Caption file (.vtt)'), {
      target: { files: [vttFile('french.vtt')] },
    });
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Upload caption' }),
    );

    expect(
      await within(dialog).findByText('French captions added'),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Remove French' }),
      ).toHaveFocus(),
    );
  });

  it('replaces a track by uploading the same language, and says so', async () => {
    const attach = vi.fn(() => ({ captions: [] }));
    const rendered = renderDialog({
      'contentItem.captionUploadUrl': () => ({
        uploadId: 'up-2',
        url: 'https://upload.test/put',
        headers: {},
      }),
      'contentItem.attachCaption': attach,
    });
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    await rendered.user.selectOptions(
      within(dialog).getByLabelText('Language'),
      'es-ES',
    );
    expect(
      within(dialog).getByText(/replaces the Spanish track/i),
    ).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('Caption file (.vtt)'), {
      target: { files: [vttFile()] },
    });
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Replace caption' }),
    );

    await waitFor(() =>
      expect(attach).toHaveBeenCalledWith({
        ...keys,
        uploadId: 'up-2',
        language: 'es-ES',
      }),
    );
  });

  it('refuses a file that is not .vtt before uploading anything', async () => {
    const rendered = renderDialog({});
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    fireEvent.change(within(dialog).getByLabelText('Caption file (.vtt)'), {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });
    await rendered.user.click(
      within(dialog).getByRole('button', {
        name: /Upload caption|Replace caption/,
      }),
    );

    expect(
      await within(dialog).findByText('Choose a WebVTT file (.vtt).'),
    ).toBeVisible();
    expect(
      rendered.calls.some(
        ({ path }) => path === 'contentItem.captionUploadUrl',
      ),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's message for an eleventh track or a bad file", async () => {
    const rendered = renderDialog({
      'contentItem.captionUploadUrl': () => ({
        uploadId: 'up-3',
        url: 'https://upload.test/put',
        headers: {},
      }),
      'contentItem.attachCaption': () => {
        throw new ApiError(
          'BAD_REQUEST',
          'A video can have at most 10 caption tracks',
        );
      },
    });
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    fireEvent.change(within(dialog).getByLabelText('Caption file (.vtt)'), {
      target: { files: [vttFile()] },
    });
    await rendered.user.click(
      within(dialog).getByRole('button', {
        name: /Upload caption|Replace caption/,
      }),
    );

    expect(
      await within(dialog).findByText(
        'A video can have at most 10 caption tracks',
      ),
    ).toBeVisible();
  });

  it('shows a failed PUT to the upload URL without attaching', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    const attach = vi.fn();
    const rendered = renderDialog({
      'contentItem.captionUploadUrl': () => ({
        uploadId: 'up-4',
        url: 'https://upload.test/put',
        headers: {},
      }),
      'contentItem.attachCaption': attach,
    });
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    fireEvent.change(within(dialog).getByLabelText('Caption file (.vtt)'), {
      target: { files: [vttFile()] },
    });
    await rendered.user.click(
      within(dialog).getByRole('button', {
        name: /Upload caption|Replace caption/,
      }),
    );

    expect(
      await within(dialog).findByText('Failed to upload the caption file'),
    ).toBeVisible();
    expect(attach).not.toHaveBeenCalled();
  });

  it('removes a track only after confirmation', async () => {
    const remove = vi.fn(() => ({ captions: [] }));
    const rendered = renderDialog({ 'contentItem.removeCaption': remove });
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Remove Spanish' }),
    );
    expect(remove).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('alertdialog');
    await rendered.user.click(
      within(confirm).getByRole('button', { name: 'Remove caption' }),
    );

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ ...keys, trackId: 't-es' }),
    );
  });

  it('keeps the track when the confirmation is cancelled', async () => {
    const remove = vi.fn();
    const rendered = renderDialog({ 'contentItem.removeCaption': remove });
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Remove English' }),
    );
    const confirm = await screen.findByRole('alertdialog');
    await rendered.user.click(
      within(confirm).getByRole('button', { name: 'Cancel' }),
    );

    expect(remove).not.toHaveBeenCalled();
    expect(within(dialog).getByText('English')).toBeVisible();
  });

  it("shows the API's message when removing fails", async () => {
    const rendered = renderDialog({
      'contentItem.removeCaption': () => {
        throw new ApiError('CONFLICT', 'Try again');
      },
    });
    const dialog = await open(rendered);
    await within(dialog).findByText('Spanish');

    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Remove Spanish' }),
    );
    const confirm = await screen.findByRole('alertdialog');
    await rendered.user.click(
      within(confirm).getByRole('button', { name: 'Remove caption' }),
    );

    expect(await within(confirm).findByText('Try again')).toBeVisible();
    expect(
      within(confirm).getByText("Couldn't remove the caption"),
    ).toBeVisible();
  });

  it('loads the captions again on Try again', async () => {
    let attempts = 0;
    const rendered = renderDialog({
      'contentItem.createVideoUrl': () => {
        attempts += 1;
        if (attempts === 1) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Down');
        }
        return videoUrl([auto], 'ready');
      },
    });
    const dialog = await open(rendered);

    await rendered.user.click(
      await within(dialog).findByRole('button', { name: 'Try again' }),
    );

    expect(await within(dialog).findByText('English')).toBeInTheDocument();
  });

  describe('translations', () => {
    const open_ = async (translations: Translation[], handlers = {}) => {
      const rendered = renderDialog({
        'contentItem.createVideoUrl': () =>
          videoUrl([auto, uploaded], 'ready', translations),
        ...handlers,
      });
      return { rendered, dialog: await open(rendered) };
    };

    it.each([
      [row('translating'), 'German: Translating…'],
      [row('failed'), 'German: Translation failed'],
      [row('too-long'), 'German: Captions are too long to translate'],
      [row('no-room'), 'German: No room (10 tracks at most)'],
      [row('not-translated', 'no-captions'), 'German: Needs captions first'],
      [
        row('not-translated', 'language-mismatch'),
        "German: The automatic captions aren't in the course's language. Upload captions in the video's language to translate them.",
      ],
      [
        row('not-translated', 'disabled'),
        "German: Translation isn't available on this site",
      ],
    ])('shows the row for %j', async (translation, text) => {
      const { dialog } = await open_([translation]);

      expect(await within(dialog).findByText(text)).toBeVisible();
      expect(within(dialog).getByText('Translations')).toBeVisible();
    });

    it('lists no row for a language that has its own track', async () => {
      const { dialog } = await open_([
        row('translated', undefined, 'fr-FR'),
        row('uploaded', undefined, 'es-ES'),
      ]);

      await within(dialog).findByText('Spanish');
      expect(within(dialog).queryByText('Translations')).toBeNull();
    });

    it.each(['failed', 'translating'])(
      'offers Translate again for a %s row and calls the retry',
      async (state) => {
        const retry = vi.fn(() => []);
        const { rendered, dialog } = await open_([row(state)], {
          'contentItem.retryCaptionTranslation': retry,
        });

        await rendered.user.click(
          await within(dialog).findByRole('button', {
            name: 'Translate again',
          }),
        );

        await waitFor(() => expect(retry).toHaveBeenCalledWith(keys));
      },
    );

    it.each(['too-long', 'no-room'])(
      'offers no Translate again for a %s row',
      async (state) => {
        const { dialog } = await open_([row(state)]);

        await within(dialog).findByText('Translations');
        expect(
          within(dialog).queryByRole('button', { name: 'Translate again' }),
        ).toBeNull();
      },
    );

    describe('polling', () => {
      beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('refetches every 5 seconds while a row is translating, then stops', async () => {
        let state = 'translating';
        const { rendered, dialog } = await open_([], {
          'contentItem.createVideoUrl': () =>
            videoUrl([auto], 'ready', [row(state)]),
        });
        const fetches = () =>
          rendered.calls.filter(
            ({ path }) => path === 'contentItem.createVideoUrl',
          ).length;
        await within(dialog).findByText('German: Translating…');
        const first = fetches();

        state = 'failed';
        await vi.advanceTimersByTimeAsync(5100);
        await within(dialog).findByText('German: Translation failed');
        expect(fetches()).toBe(first + 1);

        await vi.advanceTimersByTimeAsync(20_000);
        expect(fetches()).toBe(first + 1);
      });
    });
  });
});
