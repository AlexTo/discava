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

const videoUrl = (captions = [auto, uploaded], captionsStatus = 'ready') => ({
  url: 'https://media.test/master.m3u8',
  withCredentials: false,
  versionId: 'v1',
  captionsStatus,
  captions,
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

    expect(await screen.findByText('Try again')).toBeVisible();
  });
});
