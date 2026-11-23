/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithInstructorApi } from '../../../../../test/render-with-instructor-api';
import { ResponseDialog } from './response-dialog';

const renderDialog = () =>
  renderWithInstructorApi(
    <ResponseDialog
      courseId="course-1"
      reviewerId="r1"
      reviewerName="Sam"
      existing="Thanks"
      trigger={<button type="button">Edit response</button>}
    />,
  );

describe('ResponseDialog', () => {
  it('Cancel resets what was typed, and the saved response shows again', async () => {
    const { user } = renderDialog();
    const open = () =>
      user.click(screen.getByRole('button', { name: 'Edit response' }));

    await open();
    await user.type(screen.getByLabelText('Response'), ' a lot');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await open();

    expect(screen.getByLabelText('Response')).toHaveValue('Thanks');
  });

  it('asks on Escape with changes, and closes at once without', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit response' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit response' }));
    await user.type(screen.getByLabelText('Response'), '!');
    await user.keyboard('{Escape}');
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Response')).toHaveValue('Thanks!');
  });
});
