/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ApiUser, apiUser, createPublishedCourseViaApi } from './api.js';
import { expect } from './table-invariants.js';
import { uniqueName } from './users.js';

// Setting up and waiting on course reviews for the review scenarios (#279),
// through the APIs rather than the portals.

// A published course made by a fresh instructor.
export const createReviewedCourse = async (label: string) => {
  const instructor = await apiUser('Ines', ['instructor']);
  const title = uniqueName(label);
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  return { instructor, title, courseId };
};

// A fresh student enrolled in the course.
export const enrolledStudent = async (courseId: string, givenName = 'Sam') => {
  const student = await apiUser(givenName, ['student']);
  await student.core.course.enrol.mutate({ courseId });
  return student;
};

// A student who posts a review at once.
export const postReview = async (
  courseId: string,
  rating: 1 | 2 | 3 | 4 | 5,
  text?: string,
  givenName = 'Sam',
) => {
  const student = await enrolledStudent(courseId, givenName);
  await student.core.review.post.mutate({ courseId, rating, text });
  return student;
};

// Waits until search shows the course with this many ratings: the rating
// reaches the index through the table's stream, the router's queue and the
// search-indexing feature, which batches for up to 5s, so it lands a few
// seconds after the write. Polls rather than sleeping, as the progress
// helpers do.
export const waitForSearchRating = async (
  viewer: ApiUser,
  title: string,
  expected: { count: number; average?: number },
) => {
  await expect
    .poll(
      async () => {
        const { items } = await viewer.core.course.publicSearch
          .query({ q: title })
          .catch(() => ({ items: [] }));
        const hit = items.find((item) => item.title === title);
        return hit && { count: hit.ratingCount, average: hit.ratingAverage };
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toEqual({ count: expected.count, average: expected.average });
};

// The titles of a search for `q`, best first, once all of `titles` are in it.
export const searchTitles = async (
  viewer: ApiUser,
  q: string,
  sort: 'relevance' | 'rating' | 'newest',
) => {
  const { items } = await viewer.core.course.publicSearch.query({ q, sort });
  return items.map((item) => item.title);
};
