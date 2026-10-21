/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_MEDIA_URL,
  renderWithCoreApi,
} from '../test/render-with-core-api';
import { CourseThumbnail } from './course-thumbnail';

const course = { courseId: 'course-1', title: 'Linear Algebra' };

describe('CourseThumbnail', () => {
  it('shows the course’s image from the public media domain', async () => {
    const { findByRole } = renderWithCoreApi(
      <div data-testid="card">
        <CourseThumbnail
          course={{ ...course, imageKey: 'courses/course-1/image/abc.jpg' }}
        />
      </div>,
    );

    expect(await findByRole('presentation')).toHaveAttribute(
      'src',
      `${PUBLIC_MEDIA_URL}courses/course-1/image/abc.jpg`,
    );
  });

  it('stands in a placeholder until the course has an image', async () => {
    const { findByTestId } = renderWithCoreApi(
      <div data-testid="card">
        <CourseThumbnail course={course} />
      </div>,
    );

    const card = await findByTestId('card');
    expect(card.querySelector('img')).toBeNull();
    expect(card.textContent).not.toBe('');
  });
});
