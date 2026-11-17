/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CourseCertificatesSwitch } from './course-certificates-switch';

const COURSE_ID = 'course-1';

const renderSwitch = (certificatesEnabled: boolean, handlers = {}) =>
  renderWithInstructorApi(
    <CourseCertificatesSwitch
      courseId={COURSE_ID}
      certificatesEnabled={certificatesEnabled}
    />,
    { handlers },
  );

const toggle = () =>
  screen.getByRole('switch', { name: 'Issue a certificate on completion' });

describe('CourseCertificatesSwitch', () => {
  it('explains what the setting applies to', () => {
    renderSwitch(true);

    expect(
      screen.getByText(
        'Applies to students who complete the course from now on; certificates already issued stay valid.',
      ),
    ).toBeInTheDocument();
  });

  it.each([true, false])('shows the current state: %s', (enabled) => {
    renderSwitch(enabled);

    expect(toggle()).toHaveAttribute('aria-checked', String(enabled));
  });

  it('turns certificates off with course.setCertificates', async () => {
    const { calls, user } = renderSwitch(true, {
      'course.setCertificates': () => ({ certificatesEnabled: false }),
    });

    await user.click(toggle());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setCertificates',
          input: { courseId: COURSE_ID, enabled: false },
        },
      ]),
    );
  });

  it('turns certificates on with course.setCertificates', async () => {
    const { calls, user } = renderSwitch(false, {
      'course.setCertificates': () => ({ certificatesEnabled: true }),
    });

    await user.click(toggle());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setCertificates',
          input: { courseId: COURSE_ID, enabled: true },
        },
      ]),
    );
  });

  it('refreshes the course view after saving', async () => {
    const { queryClient, optionsProxy, user } = renderSwitch(true, {
      'course.setCertificates': () => ({ certificatesEnabled: false }),
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(toggle());

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      }),
    );
  });

  it('shows an error and restores the switch when saving fails', async () => {
    const { user } = renderSwitch(true, {
      'course.setCertificates': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something broke');
      },
    });

    await user.click(toggle());

    expect(
      await screen.findByText("Couldn't change the certificate setting"),
    ).toBeInTheDocument();
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });
});
