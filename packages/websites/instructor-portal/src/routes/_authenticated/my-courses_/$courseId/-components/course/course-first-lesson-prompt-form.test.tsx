/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CourseFirstLessonPromptForm } from './course-first-lesson-prompt-form';

const COURSE_ID = 'course-1';
const DEFAULT_PROMPT = 'What do you want to do with this course?';
const OWN_PROMPT = 'What will you build first?';

const renderForm = (firstLessonPrompt?: string, handlers = {}) =>
  renderWithInstructorApi(
    <CourseFirstLessonPromptForm
      courseId={COURSE_ID}
      firstLessonPrompt={firstLessonPrompt}
      defaultFirstLessonPrompt={DEFAULT_PROMPT}
    />,
    { handlers },
  );

const field = () => screen.getByLabelText('Prompt');
const save = () => screen.getByRole('button', { name: 'Save prompt' });

describe('CourseFirstLessonPromptForm', () => {
  it('shows the heading and help', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: 'First-lesson prompt' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/New learners see this in the first lesson's Questions/),
    ).toBeInTheDocument();
  });

  it('shows an empty field with the default as placeholder, and says so', () => {
    renderForm();

    expect(field()).toHaveValue('');
    expect(field()).toHaveAttribute('placeholder', DEFAULT_PROMPT);
    expect(screen.getByText('Using the default prompt.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Use default' }),
    ).not.toBeInTheDocument();
  });

  it("shows the course's own text, with the count and a Use default button", () => {
    renderForm(OWN_PROMPT);

    expect(field()).toHaveValue(OWN_PROMPT);
    expect(screen.getByText(`${OWN_PROMPT.length} / 200`)).toBeInTheDocument();
    expect(
      screen.queryByText('Using the default prompt.'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Use default' }),
    ).toBeInTheDocument();
  });

  it('has Save prompt disabled while the text is unchanged', async () => {
    const { user } = renderForm(OWN_PROMPT);

    expect(save()).toBeDisabled();
    await user.type(field(), '?');
    expect(save()).toBeEnabled();
    await user.type(field(), '{Backspace}');
    expect(save()).toBeDisabled();
  });

  it('sends the trimmed text', async () => {
    const { calls, user } = renderForm(undefined, {
      'course.setFirstLessonPrompt': () => ({}),
    });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await user.type(field(), `  ${OWN_PROMPT}  `);
    await user.click(save());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setFirstLessonPrompt',
          input: { courseId: COURSE_ID, prompt: OWN_PROMPT },
        },
      ]),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('sends null for a blank field', async () => {
    const { calls, user } = renderForm(OWN_PROMPT, {
      'course.setFirstLessonPrompt': () => ({}),
    });

    await user.clear(field());
    await user.type(field(), '   ');
    await user.click(save());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setFirstLessonPrompt',
          input: { courseId: COURSE_ID, prompt: null },
        },
      ]),
    );
  });

  it('cannot type past 200 characters', async () => {
    const { user } = renderForm();

    await user.click(field());
    await user.paste('a'.repeat(201));

    expect(field()).toHaveValue('a'.repeat(200));
    expect(screen.getByText('200 / 200')).toBeInTheDocument();
  });

  it('shows the API message and keeps the typed text when saving fails', async () => {
    const { user } = renderForm(OWN_PROMPT, {
      'course.setFirstLessonPrompt': () => {
        throw new ApiError(
          'BAD_REQUEST',
          'The prompt must be at most 200 characters',
        );
      },
    });

    await user.clear(field());
    await user.type(field(), 'Something else');
    await user.click(save());

    expect(
      await screen.findByText("Couldn't save the prompt"),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The prompt must be at most 200 characters'),
    ).toBeInTheDocument();
    expect(field()).toHaveValue('Something else');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('sends the typed text again on Save after a failure', async () => {
    const sent: unknown[] = [];
    const { user } = renderForm(OWN_PROMPT, {
      'course.setFirstLessonPrompt': (input: unknown) => {
        sent.push(input);
        if (sent.length === 1) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Try again');
        }
        return {};
      },
    });

    await user.clear(field());
    await user.type(field(), 'Something else');
    await user.click(save());
    await screen.findByText("Couldn't save the prompt");
    await user.click(save());

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ courseId: COURSE_ID, prompt: 'Something else' });
  });

  it('sends null from Use default and clears the field', async () => {
    const { calls, user } = renderForm(OWN_PROMPT, {
      'course.setFirstLessonPrompt': () => ({}),
    });

    await user.click(screen.getByRole('button', { name: 'Use default' }));

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setFirstLessonPrompt',
          input: { courseId: COURSE_ID, prompt: null },
        },
      ]),
    );
    expect(field()).toHaveValue('');
  });

  it('has no arrow icons', () => {
    const { container } = renderForm(OWN_PROMPT);

    expect(container.querySelector('svg')).toBeNull();
  });
});
