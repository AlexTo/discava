/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
} from '@discava/common-server-utils/lesson-media';
import { previewManifestNonce } from '@discava/common-server-utils/media-keys';
import {
  type CoreTable,
  filterEffectivelyVisible,
  isOpenFreePreview,
  REFUND_PROGRESS_LIMIT_PERCENT,
  REFUND_WINDOW_DAYS,
  resolveFirstLessonPrompt,
  tracksForPlayback,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { playablePreviewManifest } from '../helpers/course-preview.js';
import { asStudentContentItem } from '../helpers/playback.js';
import { ratingFigures } from '../helpers/rating.js';
import { courseProcedure, publicCourseProcedure } from '../init.js';
import {
  type IViewCourseOutput,
  ListCoursesByInstructorInputSchema,
  ListCoursesByInstructorOutputSchema,
  ListInstructorsForCourseInputSchema,
  ListInstructorsForCourseOutputSchema,
  PreviewVideoUrlInputSchema,
  PreviewVideoUrlOutputSchema,
  PublicListCoursesInputSchema,
  PublicListCoursesOutputSchema,
  PublicViewCourseOutputSchema,
  ViewCourseInputSchema,
  ViewCourseOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

// How often a page's ratings are asked for again when DynamoDB leaves some
// unprocessed, before the call fails rather than show them as unrated.
const RATING_READ_ATTEMPTS = 3;

export const listCoursesByInstructor = courseProcedure
  .input(ListCoursesByInstructorInputSchema)
  .output(ListCoursesByInstructorOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { instructorId, cursor, limit } = input;

    // byInstructor's sort key is courseUpdatedAt#courseId; order: 'desc'
    // surfaces the most recently updated courses first.
    const { data: memberships, cursor: nextCursor } =
      await coreTable.entities.courseInstructor.query
        .byInstructor({ instructorId })
        .go({ cursor, limit, order: 'desc' });
    if (memberships.length === 0) {
      return { items: [], cursor: nextCursor };
    }

    // preserveBatchOrder so a course deleted after its membership row was
    // written shows up as a null gap to filter out, not a silently
    // reordered/shortened page.
    const { data: courses } = await coreTable.entities.course
      .get(memberships.map(({ courseId }) => ({ courseId })))
      .go({ preserveBatchOrder: true });

    return {
      items: courses.filter((course) => course !== null),
      cursor: nextCursor,
    };
  });

export const listInstructorsForCourse = courseProcedure
  .input(ListInstructorsForCourseInputSchema)
  .output(ListInstructorsForCourseOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, cursor, limit } = input;

    const { data: memberships, cursor: nextCursor } =
      await coreTable.entities.courseInstructor.query
        .primary({ courseId })
        .go({ cursor, limit });
    if (memberships.length === 0) {
      return { items: [], cursor: nextCursor };
    }

    const { data: instructors } = await coreTable.entities.user
      .get(memberships.map(({ instructorId }) => ({ userId: instructorId })))
      .go({ preserveBatchOrder: true });

    return {
      items: instructors.filter((instructor) => instructor !== null),
      cursor: nextCursor,
    };
  });

export const publicListCourses = publicCourseProcedure
  .input(PublicListCoursesInputSchema)
  .output(PublicListCoursesOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { cursor, limit } = input;

    // byStatus's sort key is the courseId, a UUIDv7, so order: 'desc' lists
    // the newest courses first.
    const { data: courses, cursor: nextCursor } =
      await coreTable.entities.course.query
        .byStatus({ status: 'published' })
        .go({ cursor, limit, order: 'desc' });

    if (courses.length === 0) {
      return { items: [], cursor: nextCursor };
    }

    // One batch get for the whole page (at most 100 courses). A course
    // nobody has rated has no record.
    const ratings = new Map<string, Parameters<typeof ratingFigures>[0]>();
    let pending = courses.map(({ courseId }) => ({ courseId }));
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt === RATING_READ_ATTEMPTS) {
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

    return {
      items: courses.map((course) => {
        const { count, average } = ratingFigures(ratings.get(course.courseId));
        return { ...course, ratingAverage: average, ratingCount: count };
      }),
      cursor: nextCursor,
    };
  });

// Reads the profiles of a course's instructors, in the order of their
// courseInstructor records. An instructor without a profile is left out and
// logged: the instructor-has-profile invariant makes that impossible.
const readPublicInstructors = async (
  coreTable: CoreTable,
  courseId: string,
  logger?: Pick<Logger, 'warn'>,
) => {
  const { data: memberships } = await coreTable.entities.courseInstructor.query
    .primary({ courseId })
    .go({ pages: 'all' });
  if (memberships.length === 0) {
    return [];
  }
  const ordered = memberships
    .slice()
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  const profiles = new Map<
    string,
    {
      handle: string;
      displayName: string;
      headline?: string;
      photoKey?: string;
    }
  >();
  let pending = ordered.map(({ instructorId }) => ({ instructorId }));
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt === RATING_READ_ATTEMPTS) {
      throw new Error('Instructor profiles could not be read: throttled');
    }
    const { data, unprocessed } = await coreTable.entities.instructorProfile
      .get(pending)
      .go();
    for (const profile of data) {
      profiles.set(profile.instructorId, profile);
    }
    pending = unprocessed;
  }

  return ordered.flatMap(({ instructorId }) => {
    const profile = profiles.get(instructorId);
    if (!profile) {
      logger?.warn('A course instructor has no profile', { courseId });
      return [];
    }
    return [
      {
        handle: profile.handle,
        displayName: profile.displayName,
        headline: profile.headline,
        photoKey: profile.photoKey,
      },
    ];
  });
};

// Anonymous course preview for the public landing page's "Learn more" link.
// Unlike viewCourse, this never returns content items and only ever resolves
// published courses: a draft or archived course is NOT_FOUND, the same as a
// courseId that doesn't exist, so its existence isn't leaked.
export const publicViewCourse = publicCourseProcedure
  .input(ViewCourseInputSchema)
  .output(PublicViewCourseOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;

    // Every page: a course's curriculum can exceed a single 1 MB query page.
    const { data } = await coreTable.collections
      .curriculum({ courseId: input.courseId })
      .go({ pages: 'all' });
    const [course] = data.course;
    if (!course || course.status !== 'published') {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    // Only what a student may see, so a hidden or archived module or lesson
    // isn't leaked to anonymous callers either.
    const { modules, lessons } = filterEffectivelyVisible({
      modules: data.module,
      lessons: data.lesson,
      contentItems: [],
    });

    const lessonsByModuleId = new Map<string, typeof lessons>();
    for (const lesson of lessons) {
      const moduleLessons = lessonsByModuleId.get(lesson.moduleId) ?? [];
      moduleLessons.push(lesson);
      lessonsByModuleId.set(lesson.moduleId, moduleLessons);
    }

    const [instructors, category, { data: preview }] = await Promise.all([
      readPublicInstructors(coreTable, course.courseId, ctx.logger),
      course.categoryId
        ? coreTable.entities.category
            .get({ categoryId: course.categoryId })
            .go()
            .then(({ data }) => data)
        : undefined,
      coreTable.entities.coursePreview.get({ courseId: course.courseId }).go(),
    ]);

    return {
      ...course,
      learningOutcomes: course.learningOutcomes ?? [],
      requirements: course.requirements ?? [],
      category:
        category?.status === 'active'
          ? { slug: category.slug, name: category.name }
          : undefined,
      instructors,
      preview: playablePreviewManifest(course, preview)
        ? { durationSeconds: preview!.durationSeconds }
        : undefined,
      ...(course.priceAmount > 0
        ? {
            refundWindowDays: REFUND_WINDOW_DAYS,
            refundProgressLimitPercent: REFUND_PROGRESS_LIMIT_PERCENT,
          }
        : {}),
      modules: modules
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((module) => ({
          ...module,
          lessons: (lessonsByModuleId.get(module.moduleId) ?? [])
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((lesson) => ({
              ...lesson,
              freePreview: isOpenFreePreview({ course, module, lesson }),
            })),
        })),
    };
  });

// A published course's preview video, for anyone including signed-out
// visitors. Signed as contentItem.videoUrl does, with cookies scoped to the
// played version's folder only, so no lesson video of the course is reachable
// with them. Anything not playable is the same NOT_FOUND.
export const previewVideoUrl = publicCourseProcedure
  .input(PreviewVideoUrlInputSchema)
  .output(PreviewVideoUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId } = input;

    const [{ data: course }, { data: preview }] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.coursePreview.get({ courseId }).go(),
    ]);
    const manifest = playablePreviewManifest(course, preview);
    if (!manifest) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'This preview is not available',
      });
    }

    // The played version's folder: everything up to the slash before
    // master.m3u8.
    const prefixKey = manifest.slice(0, manifest.lastIndexOf('/') + 1);
    const [url, cookies] = await Promise.all([
      getCloudFrontVideoUrl(manifest),
      getSignedCloudFrontCookies(prefixKey),
    ]);
    ctx.responseCookies?.push(...cookies);

    // The folder name is the version's identity; only its tracks play.
    const versionId = previewManifestNonce(manifest) ?? '';
    const captions = await Promise.all(
      tracksForPlayback(preview!.captionTracks, versionId).map(
        async (track) => ({
          trackId: track.trackId,
          language: track.language,
          label: track.label,
          isDefault: track.isDefault,
          machineTranslated: track.source === 'translated',
          url: await getCloudFrontVideoUrl(track.key),
        }),
      ),
    );
    return { url, withCredentials: cookies.length > 0, versionId, captions };
  });

export const viewCourse = courseProcedure
  .input(ViewCourseInputSchema)
  .output(ViewCourseOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;

    // Course, its modules, their lessons, and each lesson's content items
    // all share the `curriculum` collection's partition (see
    // @discava/core-table's service.ts), so one query returns the whole
    // curriculum instead of a get plus per-module/per-lesson queries.
    // Every page: a course's curriculum can exceed a single 1 MB query page.
    const [{ data }, enrolment] = await Promise.all([
      coreTable.collections
        .curriculum({ courseId: input.courseId })
        .go({ pages: 'all' }),
      getEnrolment(coreTable, input.courseId, ctx.user.sub),
    ]);
    const [course] = data.course;
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);
    // Students only see a module, lesson or content item that is visible, not
    // archived, and not under a hidden or archived ancestor. Instructors edit
    // the full curriculum through instructor-api's course.view instead.
    const { modules, lessons, contentItems } = filterEffectivelyVisible({
      modules: data.module,
      lessons: data.lesson,
      contentItems: data.contentItem,
    });

    const contentItemsByLessonId = new Map<string, typeof contentItems>();
    for (const contentItem of contentItems) {
      const lessonContentItems =
        contentItemsByLessonId.get(contentItem.lessonId) ?? [];
      lessonContentItems.push(contentItem);
      contentItemsByLessonId.set(contentItem.lessonId, lessonContentItems);
    }

    const lessonsByModuleId = new Map<string, typeof lessons>();
    for (const lesson of lessons) {
      const moduleLessons = lessonsByModuleId.get(lesson.moduleId) ?? [];
      moduleLessons.push(lesson);
      lessonsByModuleId.set(lesson.moduleId, moduleLessons);
    }

    // contentItem's ElectroDB-inferred type is flat (`type: 'video' | 'text'`
    // alongside every other attribute as optional), not a proper union keyed
    // on `type` -- ElectroDB has no native discriminated-attribute support.
    // The cast bridges that gap to the discriminated-union output type; the
    // zod output schema is what actually validates the shape at runtime.
    return {
      ...course,
      firstLessonPrompt: resolveFirstLessonPrompt(course),
      modules: modules
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((module) => ({
          ...module,
          lessons: (lessonsByModuleId.get(module.moduleId) ?? [])
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((lesson) => ({
              ...lesson,
              contentItems: (contentItemsByLessonId.get(lesson.lessonId) ?? [])
                .slice()
                .sort((a, b) => a.order - b.order)
                .map(asStudentContentItem),
            })),
        })),
    } as IViewCourseOutput;
  });
