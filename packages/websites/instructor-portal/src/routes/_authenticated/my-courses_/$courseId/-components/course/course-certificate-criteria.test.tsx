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
import { CourseCertificateCriteria } from './course-certificate-criteria';

const COURSE_ID = 'course-1';

const renderCriteria = (
  { requireQuizPass = false, certificatesEnabled = true } = {},
  handlers = {},
) =>
  renderWithInstructorApi(
    <CourseCertificateCriteria
      courseId={COURSE_ID}
      certificatesEnabled={certificatesEnabled}
      requireQuizPass={requireQuizPass}
    />,
    { handlers },
  );

const checkbox = () =>
  screen.getByRole('checkbox', { name: 'Require passing every quiz' });

describe('CourseCertificateCriteria', () => {
  it.each([true, false])('shows the stored value: %s', (requireQuizPass) => {
    renderCriteria({ requireQuizPass });

    expect(checkbox().checked).toBe(requireQuizPass);
  });

  it('explains what the setting applies to', () => {
    renderCriteria();

    expect(
      screen.getByText(/Quizzes with a pass mark of 0% don't count/),
    ).toBeInTheDocument();
  });

  it('saves a ticked box with course.setCertificateCriteria', async () => {
    const { calls, user } = renderCriteria(
      {},
      { 'course.setCertificateCriteria': () => ({}) },
    );

    await user.click(checkbox());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setCertificateCriteria',
          input: { courseId: COURSE_ID, requireQuizPass: true },
        },
      ]),
    );
  });

  it('saves an unticked box', async () => {
    const { calls, user } = renderCriteria(
      { requireQuizPass: true },
      { 'course.setCertificateCriteria': () => ({}) },
    );

    await user.click(checkbox());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setCertificateCriteria',
          input: { courseId: COURSE_ID, requireQuizPass: false },
        },
      ]),
    );
  });

  it('shows the message and restores the box when saving fails', async () => {
    const { user } = renderCriteria(
      {},
      {
        'course.setCertificateCriteria': () => {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Something broke');
        },
      },
    );

    await user.click(checkbox());

    expect(
      await screen.findByText("Couldn't change the certificate criteria"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    expect(checkbox().checked).toBe(false);
  });

  it('is disabled, keeping its value, while certificates are off', async () => {
    const { calls, user } = renderCriteria({
      certificatesEnabled: false,
      requireQuizPass: true,
    });

    expect(checkbox()).toBeDisabled();
    expect(checkbox().checked).toBe(true);
    await user.click(checkbox());
    expect(calls).toEqual([]);
  });
});
