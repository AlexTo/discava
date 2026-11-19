/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isFinished,
  movedPath,
  rewriteForArchive,
  rewriteRelativeLinks,
} from './archive.js';

const FOLDER = '20261115-204447-certificates';

const tasksMd = (ticks: string[]) =>
  [
    '## Phase 1: User Story 1 - Issue',
    '',
    ...ticks.map(
      (tick, index) => `- [${tick}] T00${index + 1} Something${index}`,
    ),
    '',
  ].join('\n');

describe('isFinished', () => {
  it('is true when every task is ticked', () => {
    expect(isFinished(tasksMd(['x', 'X']))).toBe(true);
  });

  it('is false while a (human) task is unticked', () => {
    expect(
      isFinished(`${tasksMd(['x'])}- [ ] T009 **(human)** Check by hand\n`),
    ).toBe(false);
  });

  it('is false for a file with no tasks', () => {
    expect(isFinished('## Phase 1: Setup\n')).toBe(false);
  });
});

describe('movedPath', () => {
  it('moves paths inside the folder only', () => {
    expect(movedPath(`specs/${FOLDER}/spec.md`, FOLDER)).toBe(
      `specs/_archive/${FOLDER}/spec.md`,
    );
    expect(movedPath(`specs/${FOLDER}-two/spec.md`, FOLDER)).toBe(
      `specs/${FOLDER}-two/spec.md`,
    );
  });
});

describe('rewriteRelativeLinks', () => {
  it('adds a ../ to links out of the moved folder', () => {
    expect(
      rewriteRelativeLinks(
        '[page](../../docs/src/content/docs/en/design/certificates.mdx#rule)',
        `specs/${FOLDER}/spec.md`,
        FOLDER,
      ),
    ).toBe(
      '[page](../../../docs/src/content/docs/en/design/certificates.mdx#rule)',
    );
  });

  it('keeps links within the moved folder as written', () => {
    const text = '[spec](../spec.md) [plan](./plan.md "Plan")';
    expect(
      rewriteRelativeLinks(text, `specs/${FOLDER}/checklists/a.md`, FOLDER),
    ).toBe(text);
  });

  it('points links from another spec into the archive', () => {
    expect(
      rewriteRelativeLinks(
        `[certificates](../${FOLDER}/plan.md) and [folder](../${FOLDER}/)`,
        'specs/20261116-000000-other/spec.md',
        FOLDER,
      ),
    ).toBe(
      `[certificates](../_archive/${FOLDER}/plan.md) and [folder](../_archive/${FOLDER}/)`,
    );
  });

  it('leaves URLs, anchors and unrelated links alone', () => {
    const text =
      '[a](https://example.com/specs/x) [b](#top) [c](/abs) [d](../other/spec.md)';
    expect(rewriteRelativeLinks(text, `specs/${FOLDER}/spec.md`, FOLDER)).toBe(
      text.replace('../other/', '../../other/'),
    );
  });
});

describe('rewriteForArchive', () => {
  it('points plain mentions and GitHub URLs at the archive', () => {
    const text = `**Spec:** [\`specs/${FOLDER}/\`](https://github.com/o/r/tree/main/specs/${FOLDER}/)`;
    expect(rewriteForArchive(text, 'docs/x.mdx', FOLDER)).toBe(
      `**Spec:** [\`specs/_archive/${FOLDER}/\`](https://github.com/o/r/tree/main/specs/_archive/${FOLDER}/)`,
    );
  });

  it('rewrites mentions in code but not Markdown links there', () => {
    expect(
      rewriteForArchive(
        `// See specs/${FOLDER}/data-model.md and [x](../${FOLDER}/a.md)`,
        'packages/a/src/b.ts',
        FOLDER,
      ),
    ).toBe(
      `// See specs/_archive/${FOLDER}/data-model.md and [x](../${FOLDER}/a.md)`,
    );
  });

  it('does not touch an already archived path or a longer folder name', () => {
    const text = `specs/_archive/${FOLDER}/ specs/${FOLDER}-v2/`;
    expect(rewriteForArchive(text, 'a.md', FOLDER)).toBe(text);
  });
});
