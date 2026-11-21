/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CourseCaptionLanguagesForm } from './course-caption-languages-form';

const COURSE_ID = 'course-1';

const SUPPORTED = [
  { tag: 'en-US', label: 'English', nativeLabel: 'English' },
  { tag: 'es-ES', label: 'Spanish', nativeLabel: 'Español' },
  { tag: 'fr-FR', label: 'French', nativeLabel: 'Français' },
  { tag: 'de-DE', label: 'German', nativeLabel: 'Deutsch' },
];

const state = (overrides = {}) => ({
  languages: [] as string[],
  supported: SUPPORTED,
  enabled: true,
  maxLanguages: 3,
  ...overrides,
});

const renderForm = (
  {
    readOnly,
    ...overrides
  }: { readOnly?: boolean } & Record<string, unknown> = {},
  handlers = {},
) =>
  renderWithInstructorApi(
    <CourseCaptionLanguagesForm courseId={COURSE_ID} readOnly={readOnly} />,
    {
      handlers: {
        'course.captionLanguages': () => state(overrides),
        'course.updateCaptionLanguages': () => state(overrides),
        ...handlers,
      },
    },
  );

const box = (name: string) => screen.findByRole('checkbox', { name });
const save = () => screen.getByRole('button', { name: 'Save' });

describe('CourseCaptionLanguagesForm', () => {
  it('loads and ticks the saved languages', async () => {
    renderForm({ languages: ['fr-FR'] });

    expect(await box('French (Français)')).toBeChecked();
    expect(await box('Spanish (Español)')).not.toBeChecked();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('saves the list in the order languages were ticked, after the saved ones', async () => {
    const { calls, user } = renderForm({ languages: ['fr-FR'] });

    await user.click(await box('German (Deutsch)'));
    await user.click(await box('Spanish (Español)'));
    await user.click(save());

    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === 'course.updateCaptionLanguages'),
      ).toEqual([
        {
          path: 'course.updateCaptionLanguages',
          input: {
            courseId: COURSE_ID,
            languages: ['fr-FR', 'de-DE', 'es-ES'],
          },
        },
      ]),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('disables the unticked boxes at the limit', async () => {
    renderForm({ languages: ['es-ES', 'fr-FR', 'de-DE'] });

    expect(await box('English (English)')).toBeDisabled();
    expect(await box('Spanish (Español)')).toBeEnabled();
  });

  it('is unavailable when translation is off', async () => {
    renderForm({ enabled: false, maxLanguages: 0 });

    expect(
      await screen.findByText(
        "Caption translation isn't available on this site.",
      ),
    ).toBeInTheDocument();
    expect(await box('Spanish (Español)')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('is read-only on an archived course', async () => {
    renderForm({ languages: ['es-ES'], readOnly: true });

    expect(await box('Spanish (Español)')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('warns before a saved language is unticked', async () => {
    const { user } = renderForm({ languages: ['es-ES'] });

    await user.click(await box('Spanish (Español)'));

    expect(
      screen.getByText(
        'Translated Spanish captions will be removed from every video. Captions you uploaded stay.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no warning for a language that was never saved', async () => {
    const { user } = renderForm();

    await user.click(await box('Spanish (Español)'));
    await user.click(await box('Spanish (Español)'));

    expect(screen.queryByText(/will be removed/)).not.toBeInTheDocument();
  });

  it("shows the API's error", async () => {
    const { user } = renderForm(
      {},
      {
        'course.updateCaptionLanguages': () => {
          throw new ApiError('PRECONDITION_FAILED', 'Restore the course first');
        },
      },
    );

    await user.click(await box('Spanish (Español)'));
    await user.click(save());

    expect(
      await screen.findByText('Restore the course first'),
    ).toBeInTheDocument();
  });
});
