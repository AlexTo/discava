/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  IContentItemRef,
  IEnrolment,
  IViewCourseOutput,
} from '@discava/core-api';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCoreApi } from '../../../../hooks/useCoreApi';

export type PlayerCourse = IViewCourseOutput;
export type PlayerModule = PlayerCourse['modules'][number];
export type PlayerLesson = PlayerModule['lessons'][number];
export type PlayerItem = PlayerLesson['contentItems'][number];

// A lesson with where it sits in the course, in course order.
export interface CourseLesson {
  module: PlayerModule;
  moduleIndex: number;
  lesson: PlayerLesson;
}

// The tRPC error code a query or mutation failed with, e.g. 'FORBIDDEN'.
export const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code;

// What the course home and lesson pages read from useCoursePlayer. Spelled
// out rather than inferred: the inferred type names tRPC's internal error
// shapes, which tsc can't reference from here (TS2883).
export interface CoursePlayer {
  // Whether course.view is still loading, and why it failed if it did.
  isPending: boolean;
  error: unknown;
  course: PlayerCourse | undefined;
  enrolment: IEnrolment | null | undefined;
  readOnly: boolean;
  lessons: CourseLesson[];
  completedItemIds: Set<string>;
  isLessonComplete: (lesson: PlayerLesson) => boolean;
  // Items added to a lesson after the student completed it: visible, not
  // completed, in a lesson progress recalculation has marked completed.
  newItemIds: Set<string>;
  newItemCount: (lesson: PlayerLesson) => number;
  nextLesson: CourseLesson | undefined;
}

// Marks an item done; see useCompleteItem.
export interface CompleteItem {
  mutate: (item: IContentItemRef) => void;
  isPending: boolean;
  error: { message: string } | null;
}

// Progress recalculation runs from the core table's stream a few seconds after
// a completion (#237). Until it has, the player refetches the student's lesson
// progress and enrolment every couple of seconds, so the course's progress
// catches up without a reload, then stops, or gives up after a while.
const RECALCULATION_POLL_MS = 2_000;
const RECALCULATION_WAIT_MS = 20_000;

type CoreApi = ReturnType<typeof useCoreApi>;

interface AwaitedRecalculation {
  until: number;
  // The enrolment's progress when the completion was made.
  before: string;
}

const awaitedKey = (courseId: string) =>
  ['progressRecalculation', courseId] as const;

const enrolmentProgress = (
  queryClient: QueryClient,
  trpc: CoreApi,
  courseId: string,
) => {
  const enrolment = queryClient.getQueryData(
    trpc.course.myEnrolment.queryKey({ courseId }),
  );
  return {
    key: JSON.stringify([enrolment?.status, enrolment?.progressPercent]),
    // Recalculation writes the percentage and then, separately, the
    // completion; until both are in, 100% isn't the end of it.
    settled:
      enrolment?.progressPercent !== 100 || enrolment.status === 'completed',
  };
};

const refetchProgress = (
  queryClient: QueryClient,
  trpc: CoreApi,
  courseId: string,
) => {
  void queryClient.invalidateQueries({
    queryKey: trpc.course.myLessonProgress.queryKey({ courseId }),
  });
  void queryClient.invalidateQueries({
    queryKey: trpc.course.myEnrolment.queryKey({ courseId }),
  });
};

// Starts waiting for the recalculation a completion causes.
export const awaitProgressRecalculation = (
  queryClient: QueryClient,
  trpc: CoreApi,
  courseId: string,
) => {
  queryClient.setQueryData<AwaitedRecalculation>(awaitedKey(courseId), {
    until: Date.now() + RECALCULATION_WAIT_MS,
    before: enrolmentProgress(queryClient, trpc, courseId).key,
  });
  refetchProgress(queryClient, trpc, courseId);
};

// The progress queries' refetchInterval: poll while a recalculation is
// awaited. Recalculation writes lesson progress before the enrolment, so a
// changed enrolment means it has landed; one last refetch of both then picks
// up whatever the poll last missed.
const pollWhileRecalculating =
  (queryClient: QueryClient, trpc: CoreApi, courseId: string) =>
  (): number | false => {
    const awaited = queryClient.getQueryData<AwaitedRecalculation>(
      awaitedKey(courseId),
    );
    if (!awaited) {
      return false;
    }
    const now = enrolmentProgress(queryClient, trpc, courseId);
    if (
      Date.now() >= awaited.until ||
      (now.key !== awaited.before && now.settled)
    ) {
      queryClient.removeQueries({
        queryKey: awaitedKey(courseId),
        exact: true,
      });
      refetchProgress(queryClient, trpc, courseId);
      return false;
    }
    return RECALCULATION_POLL_MS;
  };

// Everything the course home and lesson pages show about the caller's place
// in a course: its curriculum as they may see it (course.view), the items
// they've completed (myItemCompletions) and each lesson's state
// (myLessonProgress).
//
// A lesson counts as complete once progress recalculation says so, or as soon
// as every item in it is completed here: recalculation runs a few seconds
// after a completion, and the outline shouldn't wait for it. A lesson it has
// marked completed stays complete when new items are added.
export function useCoursePlayer(courseId: string): CoursePlayer {
  const trpc = useCoreApi();
  const courseQuery = useQuery(trpc.course.view.queryOptions({ courseId }));
  // Only for a course the caller may read: course.view answers FORBIDDEN or
  // NOT_FOUND for anyone else, and these would only say the same.
  const enabled = courseQuery.isSuccess;
  const completionsQuery = useQuery(
    trpc.course.myItemCompletions.queryOptions({ courseId }, { enabled }),
  );
  const queryClient = useQueryClient();
  const refetchInterval = pollWhileRecalculating(queryClient, trpc, courseId);
  const progressQuery = useQuery(
    trpc.course.myLessonProgress.queryOptions(
      { courseId },
      { enabled, refetchInterval },
    ),
  );
  const enrolmentQuery = useQuery(
    trpc.course.myEnrolment.queryOptions(
      { courseId },
      { enabled, refetchInterval },
    ),
  );

  const course = courseQuery.data;
  const derived = useMemo(() => {
    const lessons: CourseLesson[] = (course?.modules ?? []).flatMap(
      (module, moduleIndex) =>
        module.lessons.map((lesson) => ({ module, moduleIndex, lesson })),
    );
    const completedItemIds = new Set(
      (completionsQuery.data?.items ?? []).map((item) => item.contentItemId),
    );
    const recalculatedComplete = new Set(
      (progressQuery.data?.lessons ?? [])
        .filter((lesson) => lesson.status === 'completed')
        .map((lesson) => lesson.lessonId),
    );
    const isLessonComplete = (lesson: PlayerLesson) =>
      recalculatedComplete.has(lesson.lessonId) ||
      (lesson.contentItems.length > 0 &&
        lesson.contentItems.every((item) =>
          completedItemIds.has(item.contentItemId),
        ));
    // A completed lesson stays complete when content is added to it; what was
    // added is new to the student (see the Progress and completion design
    // doc).
    const newItemIds = new Set(
      lessons
        .filter(({ lesson }) => recalculatedComplete.has(lesson.lessonId))
        .flatMap(({ lesson }) => lesson.contentItems)
        .filter((item) => !completedItemIds.has(item.contentItemId))
        .map((item) => item.contentItemId),
    );
    const newItemCount = (lesson: PlayerLesson) =>
      lesson.contentItems.filter((item) => newItemIds.has(item.contentItemId))
        .length;
    // Where "Continue" goes: the first lesson not yet complete, then the
    // first with new items, then the first lesson once everything is done.
    const nextLesson =
      lessons.find(({ lesson }) => !isLessonComplete(lesson)) ??
      lessons.find(({ lesson }) => newItemCount(lesson) > 0) ??
      lessons[0];
    return {
      lessons,
      completedItemIds,
      isLessonComplete,
      newItemIds,
      newItemCount,
      nextLesson,
    };
  }, [course, completionsQuery.data, progressQuery.data]);

  return {
    isPending: courseQuery.isPending,
    error: courseQuery.error,
    course,
    enrolment: enrolmentQuery.data,
    // An archived course is read-only: its items can't be completed.
    readOnly: course?.status === 'archived',
    ...derived,
  };
}

// Marks a text or video item done (contentItem.complete). The completion
// shows at once; lesson progress and the enrolment's percentage follow once
// progress recalculation has run, which the player waits for.
export function useCompleteItem(courseId: string): CompleteItem {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const complete = useMutation(
    trpc.contentItem.complete.mutationOptions({
      onSuccess: (completion) => {
        queryClient.setQueryData(
          trpc.course.myItemCompletions.queryKey({ courseId }),
          (current) =>
            current?.items.some(
              (item) => item.contentItemId === completion.contentItemId,
            )
              ? current
              : { items: [...(current?.items ?? []), completion] },
        );
        awaitProgressRecalculation(queryClient, trpc, courseId);
      },
      onError: (error) => {
        // The item, its lesson or module was hidden or removed meanwhile:
        // refetch the curriculum so the page shows what's there now.
        if (errorCode(error) === 'NOT_FOUND') {
          void queryClient.invalidateQueries({
            queryKey: trpc.course.view.queryKey({ courseId }),
          });
        }
      },
    }),
  );
  return {
    mutate: complete.mutate,
    isPending: complete.isPending,
    error: complete.error,
  };
}
