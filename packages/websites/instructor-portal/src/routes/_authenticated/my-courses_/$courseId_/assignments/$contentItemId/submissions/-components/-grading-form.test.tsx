/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithInstructorApi } from '../../../../../../../../test/render-with-instructor-api';
import { GradingForm } from './grading-form';

const submission = {
  state: 'returned' as const,
  version: 2,
  reviewRevision: 1,
  points: 8,
  pointsOutOf: 10,
};

const render = () =>
  renderWithInstructorApi(
    <GradingForm
      courseId="c1"
      contentItemId="i1"
      userId="u1"
      maxPoints={10}
      submission={submission}
    />,
    {
      handlers: { 'assignmentSubmission.amendGrade': () => ({}) },
    },
  );

describe('GradingForm focus', () => {
  it('moves focus to Points on Edit grade, and back to Edit grade on Cancel', async () => {
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Edit grade' }));
    await waitFor(() => expect(screen.getByLabelText('Points')).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit grade' })).toHaveFocus(),
    );
  });

  it('focuses the Returned summary and says "Grade returned" after saving', async () => {
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Edit grade' }));
    await user.click(screen.getByRole('button', { name: 'Save grade' }));

    expect(await screen.findByText('Grade returned')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByText(/^Returned: 8 \/ 10/).closest('p')).toHaveFocus(),
    );
  });
});
