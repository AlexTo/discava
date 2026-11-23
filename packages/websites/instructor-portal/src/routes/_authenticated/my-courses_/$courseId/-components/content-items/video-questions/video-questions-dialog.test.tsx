/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../../test/render-with-instructor-api';
import { VideoQuestionsDialog } from './video-questions-dialog';

// Tiptap needs layout APIs jsdom lacks; a textarea stands in, reading and
// writing a one-paragraph document.
vi.mock('../../rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={JSON.parse(value).content?.[0]?.content?.[0]?.text ?? ''}
      onChange={(event) => onChange(doc(event.target.value))}
    />
  ),
}));

// The player has no playback in jsdom: a stand-in with a button that moves
// the playhead to 0:07, and the props it was given.
vi.mock('@discava/common-shadcn/components/hls-video', () => ({
  HlsVideo: ({
    url,
    onTimeChange,
  }: {
    url: string;
    onTimeChange?: (seconds: number) => void;
  }) => (
    <div data-testid="player" data-url={url}>
      <button type="button" onClick={() => onTimeChange?.(7.9)}>
        Seek to 7.9
      </button>
    </div>
  ),
}));

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [
      text
        ? { type: 'paragraph', content: [{ type: 'text', text }] }
        : { type: 'paragraph' },
    ],
  });

const keys = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'video-1',
};

const stored = (id: string, text: string, atSeconds: number | null) => ({
  questionId: id,
  kind: 'single' as const,
  prompt: doc(text),
  options: [
    { optionId: `${id}-a`, text: 'Yes' },
    { optionId: `${id}-b`, text: 'No' },
  ],
  atSeconds,
  contentHash: 'hash',
});

const courseView = ({
  status = 'published',
  moduleArchivedAt,
  videoArchivedAt,
  studentActivityCount = 0,
  questions,
  quizVersion,
  durationSeconds = 60,
}: {
  status?: string;
  moduleArchivedAt?: string;
  videoArchivedAt?: string;
  studentActivityCount?: number;
  questions?: ReturnType<typeof stored>[];
  quizVersion?: number;
  durationSeconds?: number;
} = {}) => ({
  status,
  modules: [
    {
      moduleId: 'module-1',
      title: 'Module One',
      archivedAt: moduleArchivedAt,
      lessons: [
        {
          lessonId: 'lesson-1',
          title: 'Lesson One',
          contentItems: [
            {
              contentItemId: 'video-1',
              type: 'video',
              title: 'Lecture',
              status: 'ready',
              durationSeconds,
              archivedAt: videoArchivedAt,
              studentActivityCount,
              questions,
              answerKey: questions
                ? Object.fromEntries(
                    questions.map((q) => [
                      q.questionId,
                      { correctOptionIds: [`${q.questionId}-a`] },
                    ]),
                  )
                : undefined,
              quizVersion,
            },
          ],
        },
      ],
    },
  ],
});

const videoUrl = () => ({
  url: 'https://media.test/master.m3u8',
  withCredentials: false,
  versionId: 'v',
  captions: [],
});

const renderDialog = (
  view: ReturnType<typeof courseView> = courseView(),
  handlers: Record<string, (input: any) => unknown> = {},
) =>
  renderWithInstructorApi(
    <VideoQuestionsDialog
      {...keys}
      title="Lecture"
      trigger={<button type="button">Open</button>}
    />,
    {
      handlers: {
        'course.view': () => view,
        'contentItem.createVideoUrl': videoUrl,
        'contentItem.updateVideoQuestions': (input) => ({
          ...view.modules[0].lessons[0].contentItems[0],
          quizVersion: input.quizVersion + 1,
        }),
        ...handlers,
      },
    },
  );

const open = async (rendered: ReturnType<typeof renderDialog>) => {
  await rendered.user.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('heading', { name: /^Questions \(/ });
};

const save = () => screen.getByRole('button', { name: 'Save' });
const timeField = (n: number) =>
  screen.getByRole('textbox', { name: `Ask at, question ${n}` });

// Fills the open question: a prompt, two options, and the first correct.
const fill = async (
  user: ReturnType<typeof renderDialog>['user'],
  n: number,
  text: string,
) => {
  await user.type(screen.getByRole('textbox', { name: `Question ${n}` }), text);
  await user.type(screen.getByRole('textbox', { name: 'Option 1' }), 'Yes');
  await user.type(screen.getByRole('textbox', { name: 'Option 2' }), 'No');
  await user.click(screen.getByRole('radio', { name: 'Option 1 is correct' }));
};

describe('VideoQuestionsDialog', () => {
  it('opens a video with no questions, with the player and the add buttons', async () => {
    const rendered = renderDialog();
    await open(rendered);

    const dialog = screen.getByRole('dialog', { name: 'Questions' });
    expect(
      within(dialog).getByText('Lecture, in Module One › Lesson One'),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('player')).toHaveAttribute(
      'data-url',
      'https://media.test/master.m3u8',
    );
    expect(
      screen.getByRole('button', { name: 'Add a question here' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Add an end question' }),
    ).toBeEnabled();
  });

  it('shows a second player for Preview as student, and sends nothing', async () => {
    const rendered = renderDialog();
    await open(rendered);
    await screen.findByTestId('player');

    await rendered.user.click(
      screen.getByRole('button', { name: 'Preview as student' }),
    );

    const preview = screen.getByRole('region', { name: 'Student preview' });
    expect(within(preview).getByTestId('player')).toBeInTheDocument();
    expect(
      rendered.calls.filter(({ path }) =>
        path.includes('updateVideoQuestions'),
      ),
    ).toEqual([]);
  });

  it('adds a question at the current time, rounded down', async () => {
    const rendered = renderDialog();
    await open(rendered);
    const { user } = rendered;

    await user.click(
      await screen.findByRole('button', { name: 'Seek to 7.9' }),
    );
    expect(screen.getByText(/Current time 0:07/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Add a question here' }),
    );

    expect(timeField(1)).toHaveValue('0:07');
    expect(
      screen.getByRole('switch', { name: 'At the end, question 1' }),
    ).not.toBeChecked();
  });

  it('adds an end question', async () => {
    const rendered = renderDialog();
    await open(rendered);

    await rendered.user.click(
      screen.getByRole('button', { name: 'Add an end question' }),
    );

    expect(timeField(1)).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'At the end, question 1' }),
    ).toBeChecked();
  });

  it('re-sorts the list when a time is edited', async () => {
    const rendered = renderDialog(
      courseView({
        questions: [stored('q1', 'First?', 5), stored('q2', 'Second?', 10)],
        quizVersion: 1,
      }),
    );
    await open(rendered);
    const { user } = rendered;

    await user.clear(timeField(1));
    await user.type(timeField(1), '0:20');
    await user.tab();

    // The first question is now asked last, and is question 2.
    expect(timeField(1)).toHaveValue('0:10');
    expect(timeField(2)).toHaveValue('0:20');
  });

  it('moves a question to the end with the switch, and back', async () => {
    const rendered = renderDialog(
      courseView({
        questions: [stored('q1', 'First?', 5), stored('q2', 'Second?', 10)],
        quizVersion: 1,
      }),
    );
    await open(rendered);
    const { user } = rendered;

    await user.click(
      screen.getByRole('switch', { name: 'At the end, question 1' }),
    );

    expect(timeField(1)).toHaveValue('0:10');
    expect(timeField(2)).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'At the end, question 2' }),
    ).toBeChecked();
  });

  it('reorders only among questions at the same moment', async () => {
    const rendered = renderDialog(
      courseView({
        questions: [
          stored('q1', 'First?', 5),
          stored('q2', 'Second?', 5),
          stored('q3', 'Third?', 9),
        ],
        quizVersion: 1,
      }),
    );
    await open(rendered);
    const { user } = rendered;
    const down = (n: number) =>
      screen.getByRole('button', { name: `Move question ${n} down` });
    const up = (n: number) =>
      screen.getByRole('button', { name: `Move question ${n} up` });

    expect(up(1)).toBeDisabled();
    expect(down(2)).toBeDisabled();
    expect(down(3)).toBeDisabled();
    await user.click(down(1));
    // Expand the cards to read their prompts.
    await user.click(screen.getByRole('button', { name: 'Expand Question 1' }));
    expect(screen.getByRole('textbox', { name: 'Question 1' })).toHaveValue(
      'Second?',
    );
  });

  it('removes a question', async () => {
    const rendered = renderDialog(
      courseView({
        questions: [stored('q1', 'First?', 5), stored('q2', 'Second?', 10)],
        quizVersion: 1,
      }),
    );
    await open(rendered);

    await rendered.user.click(
      screen.getByRole('button', { name: 'Remove Question 1' }),
    );

    expect(
      screen.getByRole('heading', { name: 'Questions (1)' }),
    ).toBeInTheDocument();
    expect(timeField(1)).toHaveValue('0:10');
  });

  it('focuses the other move button when a question reaches the edge', async () => {
    const rendered = renderDialog(
      courseView({
        questions: [stored('q1', 'First?', 5), stored('q2', 'Second?', 5)],
        quizVersion: 1,
      }),
    );
    await open(rendered);

    await rendered.user.click(
      screen.getByRole('button', { name: 'Move question 2 up' }),
    );

    await waitFor(() =>
      expect(
        // It is question 1 now.
        screen.getByRole('button', { name: 'Move question 1 down' }),
      ).toHaveFocus(),
    );
  });

  it('focuses the next question header after removing one, else the previous', async () => {
    const rendered = renderDialog(
      courseView({
        questions: [
          stored('q1', 'First?', 5),
          stored('q2', 'Second?', 10),
          stored('q3', 'Third?', 15),
        ],
        quizVersion: 1,
      }),
    );
    await open(rendered);

    await rendered.user.click(
      screen.getByRole('button', { name: 'Remove Question 3' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /(Expand|Collapse) Question 2/ }),
      ).toHaveFocus(),
    );
  });

  it('does not announce the current time', async () => {
    const rendered = renderDialog(
      courseView({ questions: [], quizVersion: 0 }),
    );
    await open(rendered);

    expect(screen.getByText(/^Current time/)).not.toHaveAttribute('role');
  });

  it('notes a question timed at or past the end of the video', async () => {
    const rendered = renderDialog(
      courseView({
        durationSeconds: 30,
        questions: [stored('q1', 'First?', 5), stored('q2', 'Second?', 30)],
        quizVersion: 1,
      }),
    );
    await open(rendered);

    expect(
      screen.getAllByText(
        'After the end of the video: asked with the end check',
      ),
    ).toHaveLength(1);
  });

  it('disables both add buttons at 20 questions, saying why', async () => {
    const rendered = renderDialog(
      courseView({
        questions: Array.from({ length: 20 }, (_, i) =>
          stored(`q${i}`, `Q${i}?`, i),
        ),
        quizVersion: 1,
      }),
    );
    await open(rendered);

    expect(
      screen.getByRole('button', { name: 'Add a question here' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Add an end question' }),
    ).toBeDisabled();
    expect(
      screen.getByText('A video can have at most 20 questions.'),
    ).toBeInTheDocument();
  });

  it('marks a card with a problem and names it on Save, sending nothing', async () => {
    const rendered = renderDialog();
    await open(rendered);
    const { user, calls } = rendered;

    await user.click(
      screen.getByRole('button', { name: 'Add an end question' }),
    );
    await user.click(save());

    expect(
      await screen.findByText('1 question needs fixing', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText('Write the question.')).toBeInTheDocument();
    expect(calls.map(({ path }) => path)).not.toContain(
      'contentItem.updateVideoQuestions',
    );
  });

  it('marks a time that is not a time', async () => {
    const rendered = renderDialog(
      courseView({
        questions: [stored('q1', 'First?', 5)],
        quizVersion: 1,
      }),
    );
    await open(rendered);
    const { user } = rendered;

    await user.clear(timeField(1));
    await user.type(timeField(1), 'soon');
    await user.tab();
    await user.click(save());

    expect(
      await screen.findByText('Ask it at a time like 1:30, or at the end.'),
    ).toBeInTheDocument();
  });

  it('saves with version 0 for a video that never had questions, then with the returned version', async () => {
    const rendered = renderDialog();
    await open(rendered);
    const { user, calls } = rendered;
    const saves = () =>
      calls.filter(({ path }) => path === 'contentItem.updateVideoQuestions');

    await user.click(
      await screen.findByRole('button', { name: 'Seek to 7.9' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Add a question here' }),
    );
    await fill(user, 1, 'Ready?');
    await user.click(save());

    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].input).toMatchObject({
      ...keys,
      quizVersion: 0,
      questions: [
        {
          kind: 'single',
          atSeconds: 7,
          options: [{ text: 'Yes' }, { text: 'No' }],
        },
      ],
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Add an end question' }),
    );
    await fill(user, 2, 'Done?');
    await user.click(save());

    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1].input).toMatchObject({ quizVersion: 1 });
    expect(
      (saves()[1].input as any).questions.map((q: any) => q.atSeconds),
    ).toEqual([7, null]);
  });

  it('refreshes the course after a save', async () => {
    const rendered = renderDialog();
    await open(rendered);
    const { user, calls } = rendered;

    await user.click(
      screen.getByRole('button', { name: 'Add an end question' }),
    );
    await fill(user, 1, 'Done?');
    const before = calls.filter(({ path }) => path === 'course.view').length;
    await user.click(save());

    await waitFor(() =>
      expect(
        calls.filter(({ path }) => path === 'course.view').length,
      ).toBeGreaterThan(before),
    );
  });

  it('removing the last question and saving sends an empty list and key', async () => {
    const rendered = renderDialog(
      courseView({ questions: [stored('q1', 'First?', 5)], quizVersion: 3 }),
    );
    await open(rendered);
    const { user, calls } = rendered;

    await user.click(screen.getByRole('button', { name: 'Remove Question 1' }));
    await user.click(save());

    await waitFor(() =>
      expect(
        calls.find(({ path }) => path === 'contentItem.updateVideoQuestions')
          ?.input,
      ).toMatchObject({ quizVersion: 3, questions: [], answerKey: {} }),
    );
  });

  it('offers a reload on CONFLICT', async () => {
    const rendered = renderDialog(
      courseView({ questions: [stored('q1', 'First?', 5)], quizVersion: 1 }),
      {
        'contentItem.updateVideoQuestions': () => {
          throw new ApiError('CONFLICT', 'modified');
        },
      },
    );
    await open(rendered);
    const { user, calls } = rendered;

    await user.click(screen.getByRole('button', { name: 'Remove Question 1' }));
    await user.click(save());

    expect(
      await screen.findByText('These questions changed since you opened them'),
    ).toBeInTheDocument();
    const before = calls.filter(({ path }) => path === 'course.view').length;
    await user.click(
      screen.getByRole('button', { name: 'Reload the questions' }),
    );
    await waitFor(() =>
      expect(
        calls.filter(({ path }) => path === 'course.view').length,
      ).toBeGreaterThan(before),
    );
    // Back to what's stored.
    expect(
      await screen.findByRole('heading', { name: 'Questions (1)' }),
    ).toBeInTheDocument();
  });

  it('shows any other save error in an alert', async () => {
    const rendered = renderDialog(
      courseView({ questions: [stored('q1', 'First?', 5)], quizVersion: 1 }),
      {
        'contentItem.updateVideoQuestions': () => {
          throw new ApiError('PRECONDITION_FAILED', 'Restore the course first');
        },
      },
    );
    await open(rendered);
    const { user } = rendered;

    await user.click(screen.getByRole('button', { name: 'Remove Question 1' }));
    await user.click(save());

    expect(
      await screen.findByText("Couldn't save the questions"),
    ).toBeInTheDocument();
    expect(screen.getByText('Restore the course first')).toBeInTheDocument();
  });

  it('asks before closing with unsaved changes, and closes straight away without', async () => {
    const rendered = renderDialog();
    await open(rendered);
    const { user } = rendered;

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(
      await screen.findByRole('button', { name: 'Add an end question' }),
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(
      screen.getByRole('heading', { name: 'Questions (1)' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each([
    [
      'the course is archived',
      { status: 'archived' },
      /The course is archived/,
    ],
    [
      'its module is archived',
      { moduleArchivedAt: '2026-10-01T00:00:00.000Z' },
      /Its module, "Module One", is archived/,
    ],
    [
      'the video is archived',
      { videoArchivedAt: '2026-10-01T00:00:00.000Z' },
      /This video is archived/,
    ],
  ])('is read-only, with the reason, when %s', async (_name, view, reason) => {
    const rendered = renderDialog(
      courseView({
        ...view,
        questions: [stored('q1', 'First?', 5)],
        quizVersion: 1,
      }),
    );
    await open(rendered);

    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Add a question here' }),
    ).toBeNull();
    expect(timeField(1)).toBeDisabled();
  });

  it.each([
    [1, '1 learner has used this video.'],
    [12, '12 learners have used this video.'],
  ])(
    'tells the instructor when %i learners used the video',
    async (count, text) => {
      const rendered = renderDialog(
        courseView({ studentActivityCount: count }),
      );
      await open(rendered);

      expect(
        screen.getByText(
          `${text} Answers already recorded are kept and aren't regraded.`,
        ),
      ).toBeInTheDocument();
    },
  );

  it('has no learners notice for a video nobody has used', async () => {
    const rendered = renderDialog();
    await open(rendered);

    expect(
      screen.queryByText(/have used this video|has used this video/),
    ).toBeNull();
  });
});
