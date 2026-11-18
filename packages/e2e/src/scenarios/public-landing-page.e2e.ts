/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import { coursePageUrl, setLandingViaApi } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// The public course page shows what a visitor needs to decide: outcomes,
// requirements and who teaches. A course that is archived is not found for
// anyone, including a student who enrolled.
test('a signed-out visitor sees outcomes, requirements and instructors', async ({
  page,
}) => {
  const instructor = await apiUser('Ivy', ['instructor']);
  const title = uniqueName('E2E landing course');
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  await api.lesson.create.mutate({ courseId, moduleId, title: 'Lesson 1' });
  await setLandingViaApi(instructor, courseId, {
    learningOutcomes: ['Build a landing page', 'Read a curriculum'],
    requirements: ['A laptop'],
  });
  await api.course.publish.mutate({ courseId });

  await test.step('signed out, the sections and the instructor show', async () => {
    await page.goto(coursePageUrl(courseId));
    await expect(
      page.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    const outcomes = page.getByRole('region', { name: "What you'll learn" });
    await expect(outcomes.getByText('Build a landing page')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Requirements' }).getByText('A laptop'),
    ).toBeVisible();
    const team = page.getByRole('region', { name: 'Instructors' });
    await expect(team.getByText('View profile')).toBeVisible();
    await screenshot(page, 'landing page with outcomes and instructor', {
      fullPage: true,
    });
  });

  await test.step('archived, it is not found for a visitor or an enrolled student', async () => {
    const student = await apiUser('Sam', ['student']);
    await student.core.course.enrol.mutate({ courseId });
    await api.course.archive.mutate({ courseId });

    await page.goto(coursePageUrl(courseId));
    await expect(
      page.getByRole('heading', { name: 'Course not found' }),
    ).toBeVisible();
    await screenshot(page, 'archived course not found');

    // An enrolled student gets the same answer from the API.
    await expect(
      student.core.course.publicView.query({ courseId }),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
  });
});
