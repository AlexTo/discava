/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { LandingPageCard } from './landing-page-card';

const COURSE_ID = 'course-1';

const renderCard = (
  props: Partial<Parameters<typeof LandingPageCard>[0]> = {},
  handlers = {},
) =>
  renderWithInstructorApi(<LandingPageCard courseId={COURSE_ID} {...props} />, {
    handlers: { 'course.updateLanding': () => ({}), ...handlers },
  });

const outcomeInputs = () =>
  screen.getAllByLabelText(/^What students will learn item/);
const addOutcome = () =>
  screen.getByRole('button', { name: 'Add What students will learn item' });

describe('LandingPageCard', () => {
  it('shows the saved lists', () => {
    renderCard({ learningOutcomes: ['Build'], requirements: ['A laptop'] });

    expect(outcomeInputs()[0]).toHaveValue('Build');
    expect(screen.getByLabelText('Requirements item 1')).toHaveValue(
      'A laptop',
    );
  });

  it('adds, edits and removes items', async () => {
    const { user } = renderCard({ learningOutcomes: ['One'] });

    await user.click(addOutcome());
    await user.type(outcomeInputs()[1], 'Two');
    expect(outcomeInputs().map((input) => input.getAttribute('value'))).toEqual(
      ['One', 'Two'],
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Remove What students will learn item 1',
      }),
    );
    expect(outcomeInputs()).toHaveLength(1);
    expect(outcomeInputs()[0]).toHaveValue('Two');
  });

  it('moves items up and down', async () => {
    const { user } = renderCard({ learningOutcomes: ['A', 'B', 'C'] });

    await user.click(
      screen.getByRole('button', {
        name: 'Move down What students will learn item 1',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Move up What students will learn item 3',
      }),
    );

    expect(
      outcomeInputs().map((input) => (input as HTMLInputElement).value),
    ).toEqual(['B', 'C', 'A']);
    expect(
      screen.getByRole('button', {
        name: 'Move up What students will learn item 1',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Move down What students will learn item 3',
      }),
    ).toBeDisabled();
  });

  it('counts characters and stops at 160', async () => {
    const { user } = renderCard({ learningOutcomes: ['Build'] });

    expect(screen.getByText('5/160')).toBeInTheDocument();
    expect(outcomeInputs()[0]).toHaveAttribute('maxlength', '160');
    await user.type(outcomeInputs()[0], '!!');
    expect(screen.getByText('7/160')).toBeInTheDocument();
  });

  it('disables Add at 10 items', () => {
    renderCard({
      learningOutcomes: Array.from({ length: 10 }, (_, i) => `Item ${i}`),
    });

    expect(addOutcome()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Add Requirements item' }),
    ).toBeEnabled();
  });

  it('saves both lists with course.updateLanding, dropping blank items', async () => {
    const { calls, user } = renderCard({
      learningOutcomes: ['Build'],
      requirements: [],
    });

    await user.click(addOutcome());
    await user.click(
      screen.getByRole('button', { name: 'Add Requirements item' }),
    );
    await user.type(screen.getByLabelText('Requirements item 1'), 'A laptop');
    await user.click(screen.getByRole('button', { name: 'Save landing page' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    const call = calls.find((c) => c.path === 'course.updateLanding');
    expect(call?.input).toEqual({
      courseId: COURSE_ID,
      learningOutcomes: ['Build'],
      requirements: ['A laptop'],
    });
  });

  it('shows a server error inline and keeps the edits', async () => {
    const { user } = renderCard(
      { learningOutcomes: ['Build'] },
      {
        'course.updateLanding': () => {
          throw new ApiError('BAD_REQUEST', 'Learning outcomes item 1 is bad');
        },
      },
    );

    await user.type(outcomeInputs()[0], '!');
    await user.click(screen.getByRole('button', { name: 'Save landing page' }));

    expect(
      await screen.findByText('Learning outcomes item 1 is bad'),
    ).toBeInTheDocument();
    expect(outcomeInputs()[0]).toHaveValue('Build!');
  });

  it('Cancel goes back to the saved lists', async () => {
    const { user } = renderCard({ learningOutcomes: ['Build'] });

    await user.type(outcomeInputs()[0], '!');
    await user.click(addOutcome());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(outcomeInputs()).toHaveLength(1);
    expect(outcomeInputs()[0]).toHaveValue('Build');
  });

  it('notes that the preview video is coming', () => {
    renderCard();

    expect(screen.getByText(/Preview video: coming soon/)).toBeInTheDocument();
  });

  it('is read-only for an archived course', () => {
    renderCard({ learningOutcomes: ['Build'], readOnly: true });

    expect(outcomeInputs()[0]).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save landing page' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Add / }),
    ).not.toBeInTheDocument();
  });

  it('has no arrow icons in its buttons', () => {
    const { container } = renderCard({ learningOutcomes: ['A', 'B'] });

    for (const button of within(container).getAllByRole('button')) {
      expect(button.querySelector('svg')).toBeNull();
    }
  });
});
