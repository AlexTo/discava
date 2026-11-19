/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  type ChangedFile,
  checkUiScreenshots,
  isUiSource,
  WAIVER_LABEL,
} from './check.js';

const file = (filename: string, patch = '', status = 'modified') =>
  ({ filename, patch, status }) satisfies ChangedFile;
const SCENARIO = 'packages/e2e/src/scenarios/video.e2e.ts';
const UI = 'packages/common/shadcn/src/components/video-controls.tsx';

describe('isUiSource', () => {
  it.each([
    UI,
    'packages/websites/student-portal/src/routes/index.tsx',
    'packages/websites/admin-portal/src/styles.css',
  ])('counts %s', (name) => expect(isUiSource(name)).toBe(true));

  it.each([
    'packages/common/shadcn/src/components/video-controls.test.tsx',
    'packages/websites/student-portal/src/routeTree.gen.ts',
    'packages/websites/student-portal/src/lib/course-display.ts',
    'packages/common/web-utils/src/video-player.ts',
    'packages/apis/core-api/src/router.ts',
  ])('ignores %s', (name) => expect(isUiSource(name)).toBe(false));
});

describe('checkUiScreenshots', () => {
  it('passes when no UI source changed', () => {
    expect(
      checkUiScreenshots([file('packages/apis/core-api/src/router.ts')], []).ok,
    ).toBe(true);
  });

  it('fails when UI changed and no scenario takes screenshots', () => {
    expect(checkUiScreenshots([file(UI)], [])).toEqual({
      ok: false,
      uiFiles: [UI],
    });
  });

  it('is not satisfied by a scenario that changed without a new call', () => {
    const patch = '@@ -1 +1 @@\n-  await foo();\n+  await bar();\n';
    expect(checkUiScreenshots([file(UI), file(SCENARIO, patch)], []).ok).toBe(
      false,
    );
  });

  it('is not satisfied by a call that was only removed', () => {
    const patch = "@@ -1 +0 @@\n-  await screenshot(page, 'old');\n";
    expect(checkUiScreenshots([file(UI), file(SCENARIO, patch)], []).ok).toBe(
      false,
    );
  });

  it('is not satisfied by the helper or a file outside the scenarios', () => {
    const patch = "+  await screenshot(page, 'x');\n";
    expect(
      checkUiScreenshots(
        [
          file(UI),
          file('packages/e2e/src/helpers/screenshots.ts', patch),
          file('packages/e2e/src/helpers/other.ts', patch),
        ],
        [],
      ).ok,
    ).toBe(false);
  });

  it('passes when a scenario gains a screenshot call', () => {
    const patch = "@@ -1 +1,2 @@\n+  await screenshot(page, 'controls');\n";
    expect(checkUiScreenshots([file(UI), file(SCENARIO, patch)], []).ok).toBe(
      true,
    );
  });

  it('passes with the waiver label', () => {
    expect(checkUiScreenshots([file(UI)], [WAIVER_LABEL]).ok).toBe(true);
  });

  it('does not count a deleted UI file', () => {
    expect(checkUiScreenshots([file(UI, '', 'removed')], []).ok).toBe(true);
  });
});
