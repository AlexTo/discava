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
import { CourseCatalogueForm } from './course-catalogue-form';

const COURSE_ID = 'course-1';

const CATEGORIES = [
  { id: 'cat-1', name: 'Data' },
  { id: 'cat-2', name: 'Design' },
];

const renderForm = (
  props: Partial<Parameters<typeof CourseCatalogueForm>[0]> = {},
  handlers = {},
) =>
  renderWithInstructorApi(
    <CourseCatalogueForm courseId={COURSE_ID} tags={[]} {...props} />,
    {
      handlers: {
        'category.listActive': () => CATEGORIES,
        'course.updateCatalogue': () => ({}),
        ...handlers,
      },
    },
  );

const tagsInput = () => screen.getByLabelText('Tags');
const save = () =>
  screen.getByRole('button', { name: 'Save catalogue details' });

describe('CourseCatalogueForm', () => {
  it('adds tags on Enter and comma, and removes them', async () => {
    const { user } = renderForm();

    await user.type(tagsInput(), 'python{Enter}');
    await user.type(tagsInput(), 'Data  Science,');

    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByText('data science')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove tag python' }));
    expect(screen.queryByText('python')).not.toBeInTheDocument();
  });

  it('focuses the next tag after removing one, else the tag input', async () => {
    const { user } = renderForm({ tags: ['a', 'b'] });

    await user.click(screen.getByRole('button', { name: 'Remove tag a' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove tag b' }),
      ).toHaveFocus(),
    );

    await user.click(screen.getByRole('button', { name: 'Remove tag b' }));
    await waitFor(() => expect(tagsInput()).toHaveFocus());
  });

  it('refuses a ninth tag with a message', async () => {
    const tags = Array.from({ length: 8 }, (_, i) => `tag${i}`);
    const { user } = renderForm({ tags });

    await user.type(tagsInput(), 'extra{Enter}');

    expect(screen.getByText('A course has at most 8 tags')).toBeInTheDocument();
    expect(screen.queryByText('extra')).not.toBeInTheDocument();
  });

  it('shows an archived current category and keeps it selectable', async () => {
    renderForm({ category: { id: 'old', name: 'Legacy', archived: true } });

    const select = screen.getByLabelText('Category');
    expect(select).toHaveValue('old');
    expect(
      await screen.findByRole('option', { name: 'Legacy (archived)' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('option', { name: 'Design' }),
    ).toBeInTheDocument();
  });

  it('saves every field with course.updateCatalogue', async () => {
    const { calls, user } = renderForm();
    await screen.findByRole('option', { name: 'Design' });

    await user.selectOptions(screen.getByLabelText('Category'), 'cat-2');
    await user.selectOptions(screen.getByLabelText('Level'), 'advanced');
    await user.selectOptions(screen.getByLabelText('Language'), 'fr');
    await user.type(screen.getByLabelText('Duration (hours)'), '12');
    await user.type(tagsInput(), 'ui');
    await user.click(save());

    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'course.updateCatalogue')).toEqual([
        {
          path: 'course.updateCatalogue',
          input: {
            courseId: COURSE_ID,
            categoryId: 'cat-2',
            tags: ['ui'],
            level: 'advanced',
            language: 'fr',
            durationHours: 12,
          },
        },
      ]),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('clears a field by saving it empty', async () => {
    const { calls, user } = renderForm({
      level: 'beginner',
      language: 'en',
      durationHours: 3,
      tags: ['a'],
    });

    await user.selectOptions(screen.getByLabelText('Level'), '');
    await user.selectOptions(screen.getByLabelText('Language'), '');
    await user.clear(screen.getByLabelText('Duration (hours)'));
    await user.click(screen.getByRole('button', { name: 'Remove tag a' }));
    await user.click(save());

    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'course.updateCatalogue')).toEqual([
        {
          path: 'course.updateCatalogue',
          input: { courseId: COURSE_ID, tags: [] },
        },
      ]),
    );
  });

  it("shows the API's validation message", async () => {
    const { user } = renderForm(
      {},
      {
        'course.updateCatalogue': () => {
          throw new ApiError('BAD_REQUEST', 'Choose an active category');
        },
      },
    );

    await user.click(save());

    expect(
      await screen.findByText('Choose an active category'),
    ).toBeInTheDocument();
  });
});
