/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithInstructorApi } from '../../../../../test/render-with-instructor-api';
import { RemoveLessonTextButton } from './content-items/edit-lesson-text-dialog';
import { DeleteModuleDialog } from './module/delete-module-dialog';

// Archiving something students have used warns how much they have used it.
describe('student activity warnings on archive', () => {
  const openModuleDialog = async (archive: boolean, usedItems: number) => {
    const { user } = renderWithInstructorApi(
      <DeleteModuleDialog
        courseId="c"
        moduleId="m"
        title="Module One"
        lessonCount={2}
        archive={archive}
        usedItems={usedItems}
        trigger={<button type="button">Remove</button>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    return screen.getByRole('alertdialog');
  };

  it('a module: how many of its items students have used', async () => {
    expect(await openModuleDialog(true, 3)).toHaveTextContent(
      "Students have used 3 items in it. Their progress is kept, and counts again if it's restored.",
    );
  });

  it('no warning when nothing in it has been used', async () => {
    expect(await openModuleDialog(true, 0)).not.toHaveTextContent(
      'Students have used',
    );
  });

  // In a draft course delete is permanent and students have no data.
  it('no warning in a draft course, where delete is permanent', async () => {
    expect(await openModuleDialog(false, 3)).not.toHaveTextContent(
      'Students have used',
    );
  });

  it('an item: how many students have used it', async () => {
    const { user } = renderWithInstructorApi(
      <RemoveLessonTextButton
        courseId="c"
        moduleId="m"
        lessonId="l"
        contentItemId="i"
        title="Intro"
        archive
        students={1}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove Intro' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      '1 student has used it.',
    );
  });
});
