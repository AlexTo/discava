/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  'contentItem.videoUrl': () => ({
    url: 'https://media.example.com/master.m3u8',
  }),
  'quiz.view': () => quizView(),
  'quiz.myAttempts': () => noAttempts,
  ...overrides,
});

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
