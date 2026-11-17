/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, test } from '@playwright/test';

// Where CI picks the screenshots up to attach them to the pull request (the
// `E2E screenshots` comment). Not under Playwright's `outputDir`, which it
// empties at the start of every run.
export const SCREENSHOT_DIR = fileURLToPath(
  new URL('../../../../dist/packages/e2e/screenshots/', import.meta.url),
);

const taken = new Map<string, number>();

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Saves a screenshot of a state the pull request changed, for the reviewer to
// see without running the app: one folder per scenario, numbered in the order
// taken (`video/01-controls-paused.png`). Call it where a person would look,
// after the page has settled (an `expect` on what shows), and name what the
// picture shows rather than the step. A scenario that fails still keeps the
// ones taken before it.
export const screenshot = async (
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
) => {
  const info = test.info();
  const scenario = slug(basename(info.file).replace(/\.e2e\.ts$/, ''));
  // A retry starts the numbering again, over the failed attempt's files.
  const key = `${info.testId}:${info.retry}`;
  const number = (taken.get(key) ?? 0) + 1;
  taken.set(key, number);
  const dir = join(SCREENSHOT_DIR, scenario);
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: join(dir, `${String(number).padStart(2, '0')}-${slug(name)}.png`),
    fullPage: options.fullPage ?? false,
  });
};
