/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  addedPictures,
  commentBody,
  MARKER,
  slug,
  splitPictures,
} from './pictures.js';

const scenario = (
  patch: string,
  filename = 'packages/e2e/src/scenarios/video.e2e.ts',
) => ({
  filename,
  status: 'modified',
  patch,
});

describe('addedPictures', () => {
  it('reads added calls, on one line or split by the formatter', () => {
    const patch = [
      "+    await screenshot(student, 'captions menu with the default track');",
      ' await screenshot(student, "context line, not added");',
      '+    await screenshot(',
      '+      student,',
      "+      'A caption shown over the video',",
      '+      { fullPage: true },',
      '+    );',
    ].join('\n');
    expect(addedPictures([scenario(patch)])).toEqual([
      { scenario: 'video', name: 'captions-menu-with-the-default-track' },
      { scenario: 'video', name: 'a-caption-shown-over-the-video' },
    ]);
  });

  it('ignores removed lines, other files and removed scenarios', () => {
    expect(
      addedPictures([
        scenario("-    await screenshot(student, 'gone');"),
        scenario(
          "+screenshot(page, 'x');",
          'packages/e2e/src/helpers/captions.ts',
        ),
        { ...scenario("+screenshot(page, 'x');"), status: 'removed' },
      ]),
    ).toEqual([]);
  });
});

describe('splitPictures', () => {
  it('matches a numbered file to its scenario and name', () => {
    const added = [{ scenario: 'video', name: slug('Captions menu') }];
    expect(
      splitPictures(
        [
          'video/09-captions-menu.png',
          'video/01-controls-paused.png',
          'course/09-captions-menu.png',
        ],
        added,
      ),
    ).toEqual({
      mine: ['video/09-captions-menu.png'],
      other: ['video/01-controls-paused.png', 'course/09-captions-menu.png'],
    });
  });
});

describe('commentBody', () => {
  const base = { sha: 'abcdef1234', runUrl: 'https://x/run/1' };

  it('leads with this pull request’s pictures and folds the rest', () => {
    const body = commentBody({
      ...base,
      paths: ['video/01-a.png', 'video/02-b.png'],
      added: [{ scenario: 'video', name: 'b' }],
    });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('Added by this pull request (1)');
    expect(body).toContain('- `video/02-b.png`');
    expect(body).toContain('From scenarios that were already there (1)');
  });

  it('says so when the pull request adds none', () => {
    const body = commentBody({ ...base, paths: ['video/01-a.png'], added: [] });
    expect(body).toContain('adds no `screenshot(` call');
    expect(body).not.toContain('Added by this pull request');
  });

  it('says so when nothing was taken', () => {
    expect(commentBody({ ...base, paths: [], added: [] })).toContain(
      'No scenario took screenshots on `abcdef1`',
    );
  });
});
