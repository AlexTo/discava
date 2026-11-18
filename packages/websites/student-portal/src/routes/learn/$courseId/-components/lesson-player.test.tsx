/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { CourseHome } from './course-home';
import { LessonPage } from './lesson-page';

const AT = '2026-10-01T00:00:00.000Z';
const ref = (lessonId: string, moduleId = 'module-1') => ({
  courseId: 'course-1',
  moduleId,
  lessonId,
  createdAt: AT,
  updatedAt: AT,
});

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const textItem = (contentItemId: string, lessonId: string, title: string) => ({
  ...ref(lessonId),
  contentItemId,
  type: 'text',
  status: 'ready',
  title,
  order: 1,
  body: doc(`${title} body`),
});

const videoItem = (status = 'ready') => ({
  ...ref('lesson-1'),
  contentItemId: 'video-1',
  type: 'video',
  status,
  title: 'Lecture video',
  order: 2,
  s3Key: 'courses/course-1/video-1/nonce/master.m3u8',
  mimeType: 'application/vnd.apple.mpegurl',
});

const quizItem = {
  ...ref('lesson-1'),
  contentItemId: 'quiz-1',
  type: 'quiz',
  status: 'ready',
  title: 'Check yourself',
  order: 3,
};

const quizView = (overrides: Record<string, unknown> = {}) => ({
  ...quizItem,
  questions: [
    {
      questionId: 'q1',
      kind: 'single',
      prompt: doc('Is a matrix a vector?'),
      options: [
        { optionId: 'yes', text: 'Yes' },
        { optionId: 'no', text: 'No' },
      ],
    },
  ],
  settings: {
    passMarkPercent: 100,
    attemptsAllowed: 2,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  quizVersion: 1,
  questionsHash: 'hash-1',
  ...overrides,
});

const noAttempts = {
  summary: null,
  attempts: { items: [], cursor: null },
  reveal: null,
};

const quizAttempt = (passed: boolean) => ({
  attemptId: 'attempt-1',
  answers: { q1: [passed ? 'yes' : 'no'] },
  correctQuestionIds: passed ? ['q1'] : [],
  scorePercent: passed ? 100 : 0,
  passed,
  quizVersion: 1,
  questionsHash: 'hash-1',
  submittedAt: AT,
});

const quizSummary = (passed: boolean, attemptsUsed = 1) => ({
  attemptsUsed,
  attemptsAllowed: 2,
  bestScore: passed ? 100 : 0,
  bestAttemptId: 'attempt-1',
  ...(passed && { passedAt: AT }),
});

const course = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  title: 'Linear Algebra',
  description: 'Vectors, matrices and the four subspaces.',
  status: 'published',
  createdAt: AT,
  updatedAt: AT,
  modules: [
    {
      moduleId: 'module-1',
      courseId: 'course-1',
      title: 'Unit 1',
      order: 1,
      createdAt: AT,
      updatedAt: AT,
      lessons: [
        {
          ...ref('lesson-1'),
          title: 'Lecture 1',
          order: 1,
          contentItems: [
            textItem('text-1', 'lesson-1', 'Notes'),
            videoItem(),
            quizItem,
          ],
        },
        {
          ...ref('lesson-2'),
          title: 'Lecture 2',
          order: 2,
          contentItems: [textItem('text-2', 'lesson-2', 'More notes')],
        },
      ],
    },
  ],
  ...overrides,
});

const assignmentItem = (dueAt?: string) => ({
  ...ref('lesson-3'),
  contentItemId: 'assignment-1',
  type: 'assignment',
  status: 'ready',
  title: 'Problem set 1',
  order: 1,
  body: doc('Solve the problems'),
  maxPoints: 10,
  ...(dueAt && { dueAt }),
});

const assignmentLesson = (
  item: Record<string, unknown>,
  lessonId = 'lesson-3',
) => ({
  ...ref(lessonId),
  title: 'Problem set',
  kind: 'assignment',
  order: 3,
  contentItems: [item],
});

const courseWithAssignment = (item: Record<string, unknown>) => {
  const base = course();
  base.modules[0].lessons.push(assignmentLesson(item) as never);
  return base;
};

const enrolment = {
  courseId: 'course-1',
  userId: 'student-1',
  status: 'active',
  progressPercent: 25,
  createdAt: AT,
  updatedAt: AT,
};

const completion = (contentItemId: string, lessonId = 'lesson-1') => ({
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId,
  contentItemId,
  completedAt: AT,
});

const handlers = (overrides: Record<string, Handler> = {}) => ({
  'course.view': () => course(),
  'course.myItemCompletions': () => ({ items: [] }),
  'course.myLessonProgress': () => ({ lessons: [] }),
  'course.myEnrolment': () => enrolment,
  'announcement.list': () => ({ items: [] }),
  'contentItem.videoUrl': () => ({
    url: 'https://media.example.com/master.m3u8',
    withCredentials: false,
    versionId: 'nonce',
    resumeAt: 0,
  }),
  'contentItem.saveVideoPosition': (input: any) => ({
    saved: true,
    positionSeconds: Math.floor(input.positionSeconds),
  }),
  'quiz.view': () => quizView(),
  'quiz.myAttempts': () => noAttempts,
  'discussion.listQuestions': () => ({ items: [] }),
  ...overrides,
});

// Each crumb's text and where it links, the current page last with none.
const breadcrumbs = async () =>
  within(await screen.findByRole('navigation', { name: 'breadcrumb' }))
    .getAllByRole('listitem')
    .map((crumb) => [
      crumb.textContent,
      crumb.querySelector('a')?.getAttribute('href'),
    ]);

const outline = () =>
  screen.findByRole('navigation', { name: 'Course outline' });
const outlineLink = async (name: string) =>
  within(await outline()).getByRole('link', { name: new RegExp(name) });

describe('CourseHome', () => {
  it('lists the outline and starts at the first lesson', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers(),
    });

    expect(await outlineLink('Lecture 1')).toHaveAttribute(
      'href',
      '/learn/course-1/lesson/lesson-1',
    );
    expect(await outlineLink('Lecture 2')).toHaveTextContent('1 item');
    expect(screen.getByText('25% complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Start/ })).toHaveAttribute(
      'href',
      '/learn/course-1/lesson/lesson-1',
    );
  });

  it('shows the course announcements after where to pick up', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        'announcement.list': () => ({
          items: [
            {
              announcementId: 'a-1',
              courseId: 'course-1',
              title: 'Welcome',
              body: doc('Glad you are here'),
              authorName: 'Alice Smith',
              createdAt: AT,
            },
          ],
        }),
      }),
    });

    expect(
      await screen.findByRole('heading', { name: 'Announcements' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Glad you are here')).toBeInTheDocument();
    // Beside where to pick up, in the course's main content.
    expect(
      screen
        .getByRole('link', { name: /^Start/ })
        .compareDocumentPosition(
          screen.getByRole('heading', { name: 'Announcements' }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('places the course under My Learning, and links its course page', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers(),
    });

    expect(await breadcrumbs()).toEqual([
      ['Home', '/'],
      ['My Learning', '/my-learning'],
      ['Linear Algebra', undefined],
    ]);
    expect(screen.getByRole('link', { name: 'Course page' })).toHaveAttribute(
      'href',
      '/learn/course-1',
    );
  });

  it('continues at the first lesson not yet complete', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        // Every item of lesson 1 completed: complete before recalculation.
        'course.myItemCompletions': () => ({
          items: ['text-1', 'video-1', 'quiz-1'].map((id) => completion(id)),
        }),
      }),
    });

    expect(
      await screen.findByRole('link', { name: /^Continue/ }),
    ).toHaveAttribute('href', '/learn/course-1/lesson/lesson-2');
    expect(
      within(await outlineLink('Lecture 1')).getByLabelText('Complete'),
    ).toBeInTheDocument();
  });

  it('keeps a lesson recalculation completed complete, despite new items', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        'course.myLessonProgress': () => ({
          lessons: [
            { lessonId: 'lesson-1', status: 'completed', completedAt: AT },
            { lessonId: 'lesson-2', status: 'completed', completedAt: AT },
          ],
        }),
      }),
    });

    expect(
      await screen.findByText("You've completed this course"),
    ).toBeInTheDocument();
    // Its items have no completions: they were added since, so they're new.
    expect(
      screen.getByRole('link', { name: /See what’s new/ }),
    ).toHaveAttribute('href', '/learn/course-1/lesson/lesson-1');
  });

  it('offers a review once everything is done', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        'course.myItemCompletions': () => ({
          items: [
            completion('text-1'),
            completion('video-1'),
            completion('quiz-1'),
            completion('text-2', 'lesson-2'),
          ],
        }),
      }),
    });

    expect(
      await screen.findByText("You've completed this course"),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Review/ })).toHaveAttribute(
      'href',
      '/learn/course-1/lesson/lesson-1',
    );
  });

  it('sends a student who isn’t enrolled to the course page', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        'course.view': () => {
          throw new ApiError('FORBIDDEN', 'Enrol in the course to view it');
        },
      }),
    });

    expect(
      await screen.findByRole('heading', { name: 'Enrol to start learning' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View the course' }),
    ).toHaveAttribute('href', '/learn/course-1');
  });

  it('says when the course doesn’t exist', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        'course.view': () => {
          throw new ApiError('NOT_FOUND', 'NOT_FOUND');
        },
      }),
    });

    expect(
      await screen.findByRole('heading', { name: 'Course not found' }),
    ).toBeInTheDocument();
  });
});

const openLesson = (
  lessonId: string,
  overrides: Record<string, Handler> = {},
) =>
  renderWithCoreApi(<LessonPage courseId="course-1" lessonId={lessonId} />, {
    handlers: handlers(overrides),
  });

const item = (title: string) => screen.findByRole('article', { name: title });

describe('LessonPage', () => {
  it('shows every item of the lesson in order, with a step for each', async () => {
    openLesson('lesson-1');

    expect(
      await screen.findByRole('heading', { name: 'Lecture 1', level: 2 }),
    ).toBeInTheDocument();
    expect(
      within(await item('Notes')).getByText('Notes body'),
    ).toBeInTheDocument();
    expect(
      within(
        await screen.findByRole('navigation', { name: 'Lesson steps' }),
      ).getAllByRole('link'),
    ).toHaveLength(3);
    expect(
      within(await outlineLink('Lecture 1')).queryByLabelText('Complete'),
    ).toBeNull();
    expect(await outlineLink('Lecture 1')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the Questions section for the lesson after its items', async () => {
    const { calls } = openLesson('lesson-1');

    const questions = await screen.findByRole('region', { name: 'Questions' });
    expect(
      await within(questions).findByText(/No questions yet/),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole('article', { name: 'Notes' })
        .compareDocumentPosition(questions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      calls.find((call) => call.path === 'discussion.listQuestions')?.input,
    ).toEqual(
      expect.objectContaining({
        courseId: 'course-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
      }),
    );
  });

  it('starts the next lesson’s questions fresh, without the open thread or drafts', async () => {
    const question = {
      postId: 'q-1',
      threadId: 'q-1',
      kind: 'question',
      state: 'shown',
      authorName: 'Ada L.',
      title: 'What is a basis?',
      body: 'I am lost.',
      createdAt: AT,
      voteCount: 0,
      replyCount: 0,
    };
    const Harness = () => {
      const [lessonId, setLessonId] = useState('lesson-1');
      return (
        <>
          <button type="button" onClick={() => setLessonId('lesson-2')}>
            Go to lesson 2
          </button>
          <LessonPage courseId="course-1" lessonId={lessonId} />
        </>
      );
    };
    const { user, calls } = renderWithCoreApi(<Harness />, {
      handlers: handlers({
        'discussion.listQuestions': (input) => ({
          items:
            (input as { lessonId: string }).lessonId === 'lesson-1'
              ? [question]
              : [],
        }),
        'discussion.thread': () => ({ question, replies: [] }),
      }),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Open question' }),
    );
    await screen.findByRole('button', { name: 'Back to questions' });
    await user.type(await screen.findByLabelText('Your reply'), 'draft');

    await user.click(screen.getByRole('button', { name: 'Go to lesson 2' }));

    expect(await screen.findByText(/No questions yet/)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the question")).toBeNull();
    expect(screen.queryByLabelText('Your reply')).toBeNull();
    expect(
      calls.filter((call) => call.path === 'discussion.thread'),
    ).toHaveLength(1);
  });

  it('keeps the lesson working when the questions call fails', async () => {
    openLesson('lesson-1', {
      'discussion.listQuestions': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
      },
    });

    expect(
      await screen.findByText("Couldn't load the questions"),
    ).toBeInTheDocument();
    expect(
      within(await item('Notes')).getByText('Notes body'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Next lesson' }),
    ).toBeInTheDocument();
  });

  it('shows the questions read-only in an archived course', async () => {
    openLesson('lesson-1', {
      'course.view': () => course({ status: 'archived' }),
    });

    expect(
      await screen.findByText(
        'This course is archived, so questions are read-only.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post question' })).toBeNull();
  });

  it('plays a ready video from the URL core-api signs for it', async () => {
    const { calls } = openLesson('lesson-1');

    const video = await within(await item('Lecture video')).findByLabelText(
      'Lecture video',
    );
    expect(video.tagName).toBe('VIDEO');
    expect(
      calls.find((call) => call.path === 'contentItem.videoUrl')?.input,
    ).toEqual({
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      contentItemId: 'video-1',
    });
  });

  it('gives a ready video the speed control and the custom bar', async () => {
    openLesson('lesson-1');

    const lecture = await item('Lecture video');
    expect(
      await within(lecture).findByRole('button', { name: 'Playback speed' }),
    ).toHaveTextContent('1x');
    expect(
      within(lecture).getByLabelText('Lecture video').hasAttribute('controls'),
    ).toBe(false);
  });

  describe('captions', () => {
    const captioned = {
      'contentItem.videoUrl': () => ({
        url: 'https://media.example.com/master.m3u8',
        withCredentials: true,
        versionId: 'nonce',
        resumeAt: 0,
        captions: [
          {
            trackId: 'track-1',
            language: 'en-US',
            label: 'English',
            isDefault: true,
            url: 'https://media.example.com/nonce/captions/track-1.vtt',
          },
        ],
      }),
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('offers the captions the API lists, fetched with the signed cookies', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => 'WEBVTT',
      }));
      vi.stubGlobal('fetch', fetchMock);
      URL.createObjectURL = vi.fn(() => 'blob:captions');
      URL.revokeObjectURL = vi.fn();
      openLesson('lesson-1', captioned);

      const lecture = await item('Lecture video');

      expect(
        await within(lecture).findByRole('button', { name: /^Captions/ }),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://media.example.com/nonce/captions/track-1.vtt',
        { credentials: 'include' },
      );
    });

    it('has no captions control for a video without any', async () => {
      openLesson('lesson-1');

      const lecture = await item('Lecture video');
      await within(lecture).findByRole('button', { name: 'Playback speed' });

      expect(
        within(lecture).queryByRole('button', { name: /^Captions/ }),
      ).toBeNull();
    });
  });

  describe('resuming a video', () => {
    const resumedVideo = (resumeAt: number) =>
      openLesson('lesson-1', {
        'contentItem.videoUrl': () => ({
          url: 'https://media.example.com/master.m3u8',
          withCredentials: false,
          versionId: 'nonce',
          resumeAt,
        }),
      });

    // jsdom has no media playback: stand in for the element's clock.
    const loaded = async (position = 0, duration = 600) => {
      const video = (await within(await item('Lecture video')).findByLabelText(
        'Lecture video',
      )) as HTMLVideoElement;
      Object.defineProperty(video, 'duration', { value: duration });
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        writable: true,
        value: position,
      });
      return video;
    };

    it('resumes at the saved position, with a notice', async () => {
      resumedVideo(95);
      const video = await loaded();

      act(() => {
        video.dispatchEvent(new Event('loadedmetadata'));
      });

      expect(video.currentTime).toBe(95);
      expect(
        within(await item('Lecture video')).getByText('Resumed at 1:35'),
      ).toBeInTheDocument();
    });

    it('has no notice for a video not watched before', async () => {
      resumedVideo(0);
      const video = await loaded();

      act(() => {
        video.dispatchEvent(new Event('loadedmetadata'));
      });

      expect(
        within(await item('Lecture video')).queryByText(/Resumed at/),
      ).toBeNull();
    });

    it('saves where the student paused, for the version played', async () => {
      const { calls } = resumedVideo(0);
      const video = await loaded(42.5, 600);

      act(() => {
        video.dispatchEvent(new Event('pause'));
      });

      await waitFor(() =>
        expect(
          calls.find((call) => call.path === 'contentItem.saveVideoPosition')
            ?.input,
        ).toEqual({
          courseId: 'course-1',
          moduleId: 'module-1',
          lessonId: 'lesson-1',
          contentItemId: 'video-1',
          versionId: 'nonce',
          positionSeconds: 42.5,
          durationSeconds: 600,
        }),
      );
    });

    it('resumes from the last save when the lesson is opened again', async () => {
      const first = resumedVideo(0);
      const video = await loaded(240, 600);
      act(() => {
        video.dispatchEvent(new Event('pause'));
      });
      await waitFor(() =>
        expect(
          first.calls.some((c) => c.path === 'contentItem.saveVideoPosition'),
        ).toBe(true),
      );

      // Back to the same lesson with the query cache as the first visit left
      // it: the player must not start from the cached 0.
      first.unmount();
      cleanup();
      renderWithCoreApi(
        <LessonPage courseId="course-1" lessonId="lesson-1" />,
        {
          handlers: handlers(),
          queryClient: first.queryClient,
        },
      );
      const again = await loaded();
      act(() => {
        again.dispatchEvent(new Event('loadedmetadata'));
      });

      expect(again.currentTime).toBe(240);
    });
  });

  it('says a video is still processing, without asking for its URL', async () => {
    const { calls } = openLesson('lesson-1', {
      'course.view': () =>
        course({
          modules: [
            {
              ...course().modules[0],
              lessons: [
                {
                  ...course().modules[0].lessons[0],
                  contentItems: [videoItem('pending')],
                },
              ],
            },
          ],
        }),
    });

    expect(
      within(await item('Lecture video')).getByText(
        'This video is still processing',
      ),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.path === 'contentItem.videoUrl')).toBe(
      false,
    );
  });

  it('marks an item done when the student says so', async () => {
    const { user, calls } = openLesson('lesson-1', {
      'contentItem.complete': () => completion('text-1'),
    });

    await user.click(
      within(await item('Notes')).getByRole('button', { name: 'Mark as done' }),
    );

    expect(
      await within(await item('Notes')).findByText('Done'),
    ).toBeInTheDocument();
    expect(
      calls.find((call) => call.path === 'contentItem.complete')?.input,
    ).toEqual({
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      contentItemId: 'text-1',
    });
    expect(
      within(
        await screen.findByRole('navigation', { name: 'Lesson steps' }),
      ).getByRole('link', { name: /Step 1, done/ }),
    ).toBeInTheDocument();
  });

  it("catches up with the course's progress once recalculation has run, then stops asking (#237)", async () => {
    // Recalculation runs a few seconds after the completion: the enrolment
    // only shows it from the third fetch after (the immediate refetch and the
    // first poll still answer 25%).
    let enrolmentFetches = 0;
    const { user } = openLesson('lesson-1', {
      'contentItem.complete': () => completion('text-1'),
      'course.myEnrolment': () => {
        enrolmentFetches += 1;
        return enrolmentFetches < 4
          ? enrolment
          : { ...enrolment, progressPercent: 50 };
      },
    });
    expect(await screen.findByText('25% complete')).toBeInTheDocument();

    await user.click(
      within(await item('Notes')).getByRole('button', { name: 'Mark as done' }),
    );

    expect(
      await screen.findByText('50% complete', {}, { timeout: 8_000 }),
    ).toBeInTheDocument();
    const fetchesOnceCaughtUp = enrolmentFetches;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    // At most the one last refetch after seeing the change.
    expect(enrolmentFetches - fetchesOnceCaughtUp).toBeLessThanOrEqual(1);
  }, 15_000);

  it('ticks the lesson in the outline once its last item is done', async () => {
    const { user } = openLesson('lesson-2', {
      'contentItem.complete': () => completion('text-2', 'lesson-2'),
    });

    await user.click(
      within(await item('More notes')).getByRole('button', {
        name: 'Mark as done',
      }),
    );

    await waitFor(async () =>
      expect(
        within(await outlineLink('Lecture 2')).getByLabelText('Complete'),
      ).toBeInTheDocument(),
    );
  });

  it('offers a quiz to take, without Mark as done', async () => {
    openLesson('lesson-1');

    const quiz = await item('Check yourself');
    expect(
      await within(quiz).findByRole('button', { name: 'Start quiz' }),
    ).toBeInTheDocument();
    expect(
      within(quiz).queryByRole('button', { name: 'Mark as done' }),
    ).toBeNull();
  });

  it('grades a quiz attempt on core-api and completes it once passed', async () => {
    let completed = false;
    const { user, calls } = openLesson('lesson-1', {
      'quiz.submitAttempt': () => {
        completed = true;
        return {
          attempt: quizAttempt(true),
          summary: quizSummary(true),
          reveal: { q1: { correctOptionIds: ['yes'] } },
        };
      },
      'course.myItemCompletions': () => ({
        items: completed ? [completion('quiz-1')] : [],
      }),
    });
    const quiz = await item('Check yourself');

    await user.click(
      await within(quiz).findByRole('button', { name: 'Start quiz' }),
    );
    await user.click(within(quiz).getByRole('radio', { name: 'Yes' }));
    await user.click(
      within(quiz).getByRole('button', { name: /Review answers/ }),
    );
    await user.click(within(quiz).getByRole('button', { name: 'Submit' }));

    expect(
      await within(quiz).findByText(/This attempt: 100%/),
    ).toBeInTheDocument();
    expect(
      calls.find((call) => call.path === 'quiz.submitAttempt')?.input,
    ).toEqual({
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      contentItemId: 'quiz-1',
      answers: { q1: ['yes'] },
      questionsHash: 'hash-1',
    });
    // The server completed the quiz: the step is ticked once refetched.
    expect(
      await within(
        await screen.findByRole('navigation', { name: 'Lesson steps' }),
      ).findByRole('link', { name: /Step 3, done/ }),
    ).toBeInTheDocument();
  });

  it('reloads an edited quiz instead of grading stale answers', async () => {
    let version = 1;
    const { user, calls } = openLesson('lesson-1', {
      'quiz.view': () =>
        version === 1
          ? quizView()
          : quizView({
              questionsHash: 'hash-2',
              questions: [
                {
                  ...quizView().questions[0],
                  prompt: doc('Is every matrix a vector?'),
                },
              ],
            }),
      'quiz.submitAttempt': () => {
        version = 2;
        throw new ApiError('CONFLICT', 'This quiz was updated');
      },
    });
    const quiz = await item('Check yourself');

    await user.click(
      await within(quiz).findByRole('button', { name: 'Start quiz' }),
    );
    await user.click(within(quiz).getByRole('radio', { name: 'Yes' }));
    await user.click(
      within(quiz).getByRole('button', { name: /Review answers/ }),
    );
    await user.click(within(quiz).getByRole('button', { name: 'Submit' }));

    expect(
      await within(quiz).findByText('This quiz was updated'),
    ).toBeInTheDocument();
    expect(within(quiz).getByText('Updated')).toBeInTheDocument();
    expect(
      calls.filter((call) => call.path === 'quiz.view').length,
    ).toBeGreaterThan(1);
  });

  it('marks a quiz finished without passing in the step bar', async () => {
    openLesson('lesson-1', {
      'course.myItemCompletions': () => ({ items: [completion('quiz-1')] }),
      'quiz.myAttempts': () => ({
        summary: quizSummary(false, 2),
        attempts: { items: [quizAttempt(false)], cursor: null },
        reveal: null,
      }),
    });

    expect(
      await within(
        await screen.findByRole('navigation', { name: 'Lesson steps' }),
      ).findByRole('link', { name: /Step 3, finished but not passed/ }),
    ).toBeInTheDocument();
  });

  it('closes quizzes in an archived course', async () => {
    openLesson('lesson-1', {
      'course.view': () => course({ status: 'archived' }),
    });

    expect(
      await within(await item('Check yourself')).findByText(
        'This course is archived, so its quizzes are closed.',
      ),
    ).toBeInTheDocument();
  });

  it('can’t complete anything in an archived course', async () => {
    openLesson('lesson-1', {
      'course.view': () => course({ status: 'archived' }),
    });

    expect(
      await screen.findByText('This course is archived'),
    ).toBeInTheDocument();
    expect(
      within(await item('Notes')).getByRole('button', { name: 'Mark as done' }),
    ).toBeDisabled();
  });

  it('says an item that was removed meanwhile is gone, and reloads the course', async () => {
    const { user, calls } = openLesson('lesson-1', {
      'contentItem.complete': () => {
        throw new ApiError('NOT_FOUND', 'This item is no longer available');
      },
    });

    await user.click(
      within(await item('Notes')).getByRole('button', { name: 'Mark as done' }),
    );

    expect(
      await screen.findByText('This item is no longer available.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((call) => call.path === 'course.view')).toHaveLength(
        2,
      ),
    );
  });

  it('places the lesson under its course', async () => {
    openLesson('lesson-2');

    expect(await breadcrumbs()).toEqual([
      ['Home', '/'],
      ['My Learning', '/my-learning'],
      ['Linear Algebra', '/learn/course-1/home'],
      ['Lecture 2', undefined],
    ]);
  });

  it('says when the instructor has removed the lesson', async () => {
    openLesson('lesson-gone');

    expect(
      await screen.findByRole('heading', {
        name: 'This lesson has been removed by your instructor',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to the course' }),
    ).toHaveAttribute('href', '/learn/course-1/home');
  });

  it('links to the lessons either side', async () => {
    openLesson('lesson-1');

    expect(
      await screen.findByRole('link', { name: /Next lesson/ }),
    ).toHaveAttribute('href', '/learn/course-1/lesson/lesson-2');
    expect(screen.queryByRole('link', { name: /Previous lesson/ })).toBeNull();
  });
});

// Both lessons completed by recalculation, then a video and a quiz added to
// Lecture 1: only its text and Lecture 2's text have completions.
const withNewItems = (overrides: Record<string, Handler> = {}) => ({
  'course.myLessonProgress': () => ({
    lessons: [
      { lessonId: 'lesson-1', status: 'completed', completedAt: AT },
      { lessonId: 'lesson-2', status: 'completed', completedAt: AT },
    ],
  }),
  'course.myItemCompletions': () => ({
    items: [completion('text-1'), completion('text-2', 'lesson-2')],
  }),
  'course.myEnrolment': () => ({
    ...enrolment,
    status: 'completed',
    progressPercent: 50,
    completedAt: AT,
  }),
  ...overrides,
});

describe('items added after completing', () => {
  it('keeps the course completed and counts what’s new', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers(withNewItems()),
    });

    expect(await screen.findByText('· 2 new items')).toBeInTheDocument();
    expect(screen.getByText(/2 new items\s+added since/)).toBeInTheDocument();
    expect(await outlineLink('Lecture 1')).toHaveTextContent('2 new');
    expect(
      within(await outlineLink('Lecture 1')).getByLabelText('Complete'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /See what’s new/ }),
    ).toHaveAttribute('href', '/learn/course-1/lesson/lesson-1');
  });

  it('marks the new items in the lesson', async () => {
    openLesson('lesson-1', withNewItems());

    expect(
      await within(await item('Lecture video')).findByText('New'),
    ).toBeInTheDocument();
    expect(within(await item('Notes')).queryByText('New')).toBeNull();
    expect(
      within(
        await screen.findByRole('navigation', { name: 'Lesson steps' }),
      ).getByRole('link', { name: /Step 2, new/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('· 2 new items').length).toBeGreaterThan(0);
  });

  it('calls nothing new in a lesson not yet completed', async () => {
    openLesson('lesson-1', {
      'course.myItemCompletions': () => ({ items: [completion('text-1')] }),
    });

    await item('Lecture video');
    expect(screen.queryByText('New')).toBeNull();
  });
});

describe('assignments in the outline', () => {
  const DUE = '2026-12-24T10:30:00.000Z';
  const dueText = `Due ${new Date(DUE).toLocaleString()}`;

  it('marks an assignment with its label and due date, and a lesson not', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        'course.view': () => courseWithAssignment(assignmentItem(DUE)),
      }),
    });

    const assignment = await outlineLink('Problem set');
    expect(within(assignment).getByText('Assignment')).toBeVisible();
    expect(within(assignment).getByText(dueText)).toBeVisible();
    const lesson = await outlineLink('Lecture 2');
    expect(within(lesson).queryByText('Assignment')).toBeNull();
    expect(within(lesson).queryByText(/^Due /)).toBeNull();
  });

  it('shows no due date when there is none', async () => {
    renderWithCoreApi(<CourseHome courseId="course-1" />, {
      handlers: handlers({
        'course.view': () => courseWithAssignment(assignmentItem()),
      }),
    });

    const assignment = await outlineLink('Problem set');
    expect(within(assignment).getByText('Assignment')).toBeVisible();
    expect(within(assignment).queryByText(/^Due /)).toBeNull();
  });

  it('opens an upload assignment straight to its submit form', async () => {
    renderWithCoreApi(<LessonPage courseId="course-1" lessonId="lesson-3" />, {
      handlers: handlers({
        'course.view': () => courseWithAssignment(assignmentItem(DUE)),
        'assignment.mySubmission': () => null,
      }),
    });

    expect(
      await screen.findByRole('heading', { level: 3, name: 'Problem set 1' }),
    ).toBeVisible();
    expect(screen.getByText('Solve the problems')).toBeVisible();
    expect(
      screen.queryByRole('navigation', { name: 'Lesson steps' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull();
  });

  it('opens a quiz assignment straight to the quiz', async () => {
    renderWithCoreApi(<LessonPage courseId="course-1" lessonId="lesson-3" />, {
      handlers: handlers({
        'course.view': () =>
          courseWithAssignment({ ...quizItem, ...ref('lesson-3') }),
        'quiz.view': () => quizView(),
      }),
    });

    expect(
      await screen.findByRole('article', { name: 'Check yourself' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('navigation', { name: 'Lesson steps' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull();
  });
});
