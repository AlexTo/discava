/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../../test/render-with-instructor-api';
import { QuizBuilder } from './quiz-builder';
import type { QuizItem } from './quiz-form';

// Dragging needs real layout, which jsdom doesn't have: the provider hands the
// test the builder's drop handler instead (see lesson-content-items-row.test).
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));
vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: unknown) => void;
  }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
}));
vi.mock('@dnd-kit/react/sortable', () => ({
  useSortable: () => ({ ref: () => {}, handleRef: () => {} }),
}));
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
};

const question = (id: string, text: string) => ({
  questionId: id,
  kind: 'single' as const,
  prompt: doc(text),
  options: [
    { optionId: `${id}-a`, text: 'Yes' },
    { optionId: `${id}-b`, text: 'No' },
  ],
});

const existing: QuizItem = {
  title: 'Module check',
  description: '',
  questions: [question('q1', 'First?'), question('q2', 'Second?')],
  answerKey: {
    q1: { correctOptionIds: ['q1-a'] },
    q2: { correctOptionIds: ['q2-b'] },
  },
  settings: {
    passMarkPercent: 70,
    attemptsAllowed: null,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  quizVersion: 4,
};

const renderBuilder = (
  props: Partial<Parameters<typeof QuizBuilder>[0]> = {},
  handlers = {},
) => {
  const onCreated = vi.fn();
  const onReload = vi.fn();
  const rendered = renderWithInstructorApi(
    <QuizBuilder
      {...keys}
      onCreated={onCreated}
      onReload={onReload}
      {...props}
    />,
    { handlers },
  );
  return { ...rendered, onCreated, onReload };
};

const renderExisting = (handlers = {}, props = {}) =>
  renderBuilder(
    { contentItemId: 'quiz-1', quiz: existing, ...props },
    handlers,
  );

const save = () => screen.getByRole('button', { name: /save quiz/i });

describe('QuizBuilder', () => {
  it('creates a new quiz on the first save, then updates it', async () => {
    const { user, calls, onCreated } = renderBuilder(
      {},
      {
        'contentItem.createQuiz': () => ({
          contentItemId: 'quiz-new',
          quizVersion: 1,
        }),
        'contentItem.updateQuiz': () => ({
          contentItemId: 'quiz-new',
          quizVersion: 2,
        }),
      },
    );

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Check');
    await user.type(
      screen.getByRole('textbox', { name: 'Question 1' }),
      'Pick one',
    );
    await user.type(screen.getByRole('textbox', { name: 'Option 1' }), 'Right');
    await user.type(screen.getByRole('textbox', { name: 'Option 2' }), 'Wrong');
    await user.click(
      screen.getByRole('radio', { name: 'Option 1 is correct' }),
    );
    await user.click(save());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('quiz-new'));
    expect(screen.getByText('Saved', { exact: true })).toBeInTheDocument();
    const input = calls.find(({ path }) => path === 'contentItem.createQuiz')
      ?.input as {
      title: string;
      questions: { options: { optionId: string }[] }[];
      answerKey: Record<string, unknown>;
    };
    expect(input).toMatchObject({ ...keys, title: 'Check' });
    expect(Object.values(input.answerKey)).toEqual([
      { correctOptionIds: [input.questions[0].options[0].optionId] },
    ]);

    // The next save updates the quiz just created, at the version it got.
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await user.click(save());
    await waitFor(() =>
      expect(calls.map(({ path }) => path)).toEqual([
        'contentItem.createQuiz',
        'contentItem.updateQuiz',
      ]),
    );
    expect(calls[1].input).toMatchObject({
      contentItemId: 'quiz-new',
      quizVersion: 1,
      title: 'Check!',
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('saves an existing quiz against the version it loaded, then the version saved', async () => {
    let version = 4;
    const { user, calls } = renderExisting({
      'contentItem.updateQuiz': () => ({
        contentItemId: 'quiz-1',
        quizVersion: ++version,
      }),
    });

    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await user.click(save());
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');

    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    await user.click(save());
    await waitFor(() => expect(version).toBe(6));

    const sent = calls
      .filter(({ path }) => path === 'contentItem.updateQuiz')
      .map(({ input }) => input as { quizVersion: number; title: string });
    expect(sent.map(({ quizVersion }) => quizVersion)).toEqual([4, 5]);
    expect(sent[1]).toMatchObject({
      contentItemId: 'quiz-1',
      title: 'Module check!!',
    });
  });

  it('offers a reload when someone else saved the quiz first', async () => {
    const { user, onReload } = renderExisting({
      'contentItem.updateQuiz': () => {
        throw new ApiError('CONFLICT', 'The quiz has changed');
      },
    });

    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await user.click(save());

    expect(
      await screen.findByText('This quiz changed since you opened it'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload the quiz' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('shows any other save error as it is', async () => {
    const { user } = renderExisting({
      'contentItem.updateQuiz': () => {
        throw new ApiError('BAD_REQUEST', 'The lesson is archived');
      },
    });

    await user.click(save());

    expect(
      await screen.findByText("Couldn't save the quiz"),
    ).toBeInTheDocument();
    expect(screen.getByText('The lesson is archived')).toBeInTheDocument();
  });

  it('points at what needs fixing instead of saving', async () => {
    const { user, calls } = renderBuilder();

    await user.click(save());

    expect(screen.getByText('Give the quiz a title.')).toBeInTheDocument();
    expect(screen.getByText(/1 question needs fixing/)).toBeInTheDocument();
    expect(screen.getByText('Write the question.')).toBeInTheDocument();
    expect(
      screen.getByText('Mark exactly 1 correct option.'),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('opens the first question with problems when saving', async () => {
    const quiz = {
      ...existing,
      answerKey: { ...existing.answerKey, q2: { correctOptionIds: [] } },
    };
    const { user, calls } = renderExisting({}, { quiz });

    await user.click(save());

    expect(
      screen.getByRole('button', { name: 'Collapse Question 2' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 to fix')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('adds, moves and removes options, keeping which ones are correct', async () => {
    const { user, calls } = renderExisting({
      'contentItem.updateQuiz': () => ({
        contentItemId: 'quiz-1',
        quizVersion: 5,
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Add option' }));
    await user.type(screen.getByRole('textbox', { name: 'Option 3' }), 'Maybe');
    await user.click(screen.getByRole('button', { name: 'Move option 3 up' }));
    await user.click(screen.getByRole('button', { name: 'Remove option 1' }));
    // "Yes" was the correct option, so the question has none until one's marked.
    await user.click(save());
    expect(
      screen.getByText('Mark exactly 1 correct option.'),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click(
      screen.getByRole('radio', { name: 'Option 1 is correct' }),
    );
    await user.click(save());

    await waitFor(() => expect(calls).toHaveLength(1));
    const input = calls[0].input as {
      questions: { options: { optionId: string; text: string }[] }[];
      answerKey: Record<string, { correctOptionIds: string[] }>;
    };
    const [maybe, no] = input.questions[0].options;
    expect([maybe.text, no.text]).toEqual(['Maybe', 'No']);
    expect(no.optionId).toBe('q1-b');
    expect(input.answerKey.q1).toEqual({ correctOptionIds: [maybe.optionId] });
  });

  it('asks which answer stays correct when switching to single choice', async () => {
    const quiz = {
      ...existing,
      questions: [{ ...question('q1', 'First?'), kind: 'multiple' as const }],
      answerKey: { q1: { correctOptionIds: ['q1-a', 'q1-b'] } },
    };
    const { user } = renderExisting({}, { quiz });

    await user.click(screen.getByRole('radio', { name: 'Single choice' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Which answer stays correct?',
    });
    await user.click(within(dialog).getByRole('radio', { name: 'No' }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Switch to single choice' }),
    );

    expect(
      screen.getByRole('radio', { name: 'Single choice' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('radio', { name: 'Option 1 is correct' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Option 2 is correct' }),
    ).toBeChecked();
  });

  it('switches to multiple choice without asking', async () => {
    const { user } = renderExisting();

    await user.click(screen.getByRole('radio', { name: 'Multiple choice' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Option 1 is correct' }),
    ).toBeChecked();
  });

  it('reorders questions by drag', async () => {
    const { user, calls } = renderExisting({
      'contentItem.updateQuiz': () => ({
        contentItemId: 'quiz-1',
        quizVersion: 5,
      }),
    });

    act(() => {
      dnd.onDragEnd?.({
        canceled: false,
        operation: {
          canceled: false,
          source: { id: 'q2', initialIndex: 1, index: 0 },
          target: { id: 'q1' },
        },
      });
    });
    await user.click(save());

    await waitFor(() => expect(calls).toHaveLength(1));
    const input = calls[0].input as { questions: { questionId: string }[] };
    expect(input.questions.map(({ questionId }) => questionId)).toEqual([
      'q2',
      'q1',
    ]);
  });

  it('adds and removes questions, but always keeps one', async () => {
    const { user } = renderBuilder();

    expect(
      screen.getByRole('button', { name: 'Remove Question 1' }),
    ).toBeDisabled();
    // One question: nothing to reorder, but the handle stays (disabled).
    expect(
      screen.getByRole('button', { name: 'Reorder Question 1' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    expect(
      screen.getByRole('button', { name: 'Reorder Question 1' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('heading', { name: 'Questions (2)' }),
    ).toBeInTheDocument();
    // The new question opens for editing.
    expect(
      screen.getByRole('button', { name: 'Collapse Question 2' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Question 1' }));
    expect(
      screen.getByRole('heading', { name: 'Questions (1)' }),
    ).toBeInTheDocument();
  });

  it('saves the settings chosen', async () => {
    const { user, calls } = renderExisting({
      'contentItem.updateQuiz': () => ({
        contentItemId: 'quiz-1',
        quizVersion: 5,
      }),
    });

    await user.click(screen.getByRole('checkbox', { name: 'Unlimited' }));
    const attempts = screen.getByRole('spinbutton', {
      name: 'Number of attempts',
    });
    expect(attempts).toHaveValue(3);
    await user.clear(attempts);
    await user.type(attempts, '2');
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Shuffle the options for each student',
      }),
    );
    await user.click(
      screen.getByRole('combobox', { name: 'Show the correct answers' }),
    );
    await user.click(screen.getByRole('option', { name: 'Never' }));
    await user.click(save());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].input).toMatchObject({
      settings: {
        passMarkPercent: 70,
        attemptsAllowed: 2,
        shuffleOptions: true,
        revealAnswers: 'never',
      },
    });
  });

  it('lists the questions in a contents panel, opening the one clicked', async () => {
    const { user } = renderExisting();
    const contents = screen.getByRole('navigation', { name: 'Quiz contents' });

    expect(
      within(contents)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Settings', 'Question 1First?', 'Question 2Second?']);
    expect(
      within(contents).getByRole('button', { name: /^Question 1/ }),
    ).toHaveAttribute('aria-current', 'true');

    await user.click(
      within(contents).getByRole('button', { name: /^Question 2/ }),
    );

    expect(
      screen.getByRole('button', { name: 'Collapse Question 2' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand Question 1' }),
    ).toBeInTheDocument();
    expect(
      within(contents).getByRole('button', { name: /^Question 2/ }),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('marks the questions that need fixing in the contents panel', async () => {
    const quiz = {
      ...existing,
      answerKey: { ...existing.answerKey, q2: { correctOptionIds: [] } },
    };
    const { user } = renderExisting({}, { quiz });
    const contents = screen.getByRole('navigation', { name: 'Quiz contents' });

    await user.click(save());

    expect(
      within(contents).getByRole('button', {
        name: /^Question 2.*needs fixing/,
      }),
    ).toBeInTheDocument();
    expect(
      within(contents).getByRole('button', { name: /^Question 1/ }),
    ).not.toHaveTextContent('needs fixing');
  });

  it('warns that students have attempted the quiz', () => {
    renderExisting({}, { studentActivityCount: 3 });

    expect(
      screen.getByText('3 students have attempted this quiz'),
    ).toBeInTheDocument();
  });

  it('is read-only, with the reason, when it cannot be edited', () => {
    renderExisting(
      {},
      { readOnlyReason: 'The course is archived.', studentActivityCount: 3 },
    );

    expect(screen.getByText('The course is archived.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Option 1' })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /save quiz/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add question' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reorder Question 1' }),
    ).toBeDisabled();
    expect(
      screen.queryByText('3 students have attempted this quiz'),
    ).not.toBeInTheDocument();
  });
});

describe('Preview as student', () => {
  it('shows the quiz in the student card, graded here, without calling the API', async () => {
    const { user, calls } = renderExisting({
      'contentItem.updateQuiz': () => {
        throw new Error('the preview must not save');
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Preview as student' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Preview as student: Module check',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Start quiz' }),
    );
    expect(within(dialog).getByText('First?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }));
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }));
    await user.click(
      within(dialog).getByRole('button', { name: /Review answers/ }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    // q1 right, q2 wrong: 50%, under the 70% pass mark.
    expect(
      await within(dialog).findByText(/This attempt: 50%/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('· Not passed')).toBeInTheDocument();
    expect(within(dialog).getAllByText('(correct answer)')).toHaveLength(2);
    expect(calls).toEqual([]);
  });

  it('previews unsaved changes', async () => {
    const { user } = renderExisting();

    await user.clear(await screen.findByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Renamed check');
    await user.click(
      screen.getByRole('button', { name: 'Preview as student' }),
    );

    expect(
      await screen.findByRole('dialog', {
        name: 'Preview as student: Renamed check',
      }),
    ).toBeInTheDocument();
  });

  it('shows what needs fixing instead of previewing an incomplete quiz', async () => {
    const { user } = renderBuilder();

    await user.click(
      await screen.findByRole('button', { name: 'Preview as student' }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Give the quiz a title.')).toBeInTheDocument();
  });
});
