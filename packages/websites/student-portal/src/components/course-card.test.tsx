/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toDisplayCourse } from '../lib/course-display';
import { renderWithCoreApi } from '../test/render-with-core-api';
import { CourseCard } from './course-card';

const card = (rating: { ratingAverage?: number; ratingCount?: number }) =>
  renderWithCoreApi(
    <CourseCard
      course={toDisplayCourse({
        courseId: 'course-1',
        title: 'Linear Algebra',
        ...rating,
      })}
    />,
  );

describe('CourseCard', () => {
  it("shows a rated course's rating", async () => {
    card({ ratingAverage: 4.6, ratingCount: 128 });
    expect(await screen.findByText('4.6')).toBeInTheDocument();
    expect(screen.getByText('(128 ratings)')).toBeInTheDocument();
  });

  it('shows a single rating in the singular', async () => {
    card({ ratingAverage: 5, ratingCount: 1 });
    expect(await screen.findByText('(1 rating)')).toBeInTheDocument();
  });

  it('shows "No ratings yet" for an unrated course', async () => {
    card({ ratingCount: 0 });
    expect(await screen.findByText('No ratings yet')).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+ ratings?\)/)).not.toBeInTheDocument();
  });

  it('shows nothing about ratings where the list carries none', async () => {
    card({});
    expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();
    expect(screen.queryByText('No ratings yet')).not.toBeInTheDocument();
  });
});
