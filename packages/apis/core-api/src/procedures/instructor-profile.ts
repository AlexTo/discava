/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type CoreTable, isValidHandle } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { publicCourseProcedure } from '../init.js';
import { ratingFigures } from '../lib/rating.js';
import {
  InstructorProfilePublicViewInputSchema,
  InstructorProfilePublicViewOutputSchema,
} from '../schema/index.js';

// The most courses a profile lists: one batch get of courses.
const MAX_COURSES = 100;
// How often a batch read is asked again when DynamoDB leaves some unprocessed.
const READ_ATTEMPTS = 3;

// One error for every cause (a handle that isn't one, no claim, no profile, no
// published course), so a caller can't tell them apart.
const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Instructor not found' });

const readRatings = async (coreTable: CoreTable, courseIds: string[]) => {
  const ratings = new Map<string, Parameters<typeof ratingFigures>[0]>();
  let pending = courseIds.map((courseId) => ({ courseId }));
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt === READ_ATTEMPTS) {
      throw new Error('Ratings could not be read: throttled');
    }
    const { data, unprocessed } = await coreTable.entities.courseRating
      .get(pending)
      .go();
    for (const rating of data) {
      ratings.set(rating.courseId, rating);
    }
    pending = unprocessed;
  }
  return ratings;
};

/**
 * An instructor's public profile, found by handle. Public only while the
 * instructor teaches a published course, and lists only those courses, newest
 * publication first. Reads claim, profile, the instructor's courses, a batch
 * get of the courses and one of their ratings.
 */
export const instructorProfilePublicView = publicCourseProcedure
  .input(InstructorProfilePublicViewInputSchema)
  .output(InstructorProfilePublicViewOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const handle = input.handle.toLowerCase();
    if (!isValidHandle(handle)) {
      throw notFound();
    }

    const { data: claim } = await coreTable.entities.profileHandleClaim
      .get({ handle })
      .go();
    if (!claim) {
      throw notFound();
    }
    const { data: profile } = await coreTable.entities.instructorProfile
      .get({ instructorId: claim.instructorId })
      .go();
    if (!profile) {
      throw notFound();
    }

    const { data: memberships } =
      await coreTable.entities.courseInstructor.query
        .byInstructor({ instructorId: profile.instructorId })
        .go({ pages: 'all' });
    if (memberships.length === 0) {
      throw notFound();
    }

    // A course deleted after its membership shows as a gap to drop.
    const { data: found } = await coreTable.entities.course
      .get(memberships.map(({ courseId }) => ({ courseId })))
      .go({ preserveBatchOrder: true });
    const published = found
      .filter((course) => course !== null && course.status === 'published')
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .slice(0, MAX_COURSES);
    if (published.length === 0) {
      throw notFound();
    }

    const ratings = await readRatings(
      coreTable,
      published.map(({ courseId }) => courseId),
    );

    return {
      handle: profile.handle,
      displayName: profile.displayName,
      headline: profile.headline,
      bio: profile.bio,
      photoKey: profile.photoKey,
      courses: published.map((course) => {
        const { count, average } = ratingFigures(ratings.get(course.courseId));
        return {
          courseId: course.courseId,
          title: course.title,
          imageKey: course.imageKey,
          ratingAverage: average,
          ratingCount: count,
        };
      }),
    };
  });
