/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  changeKind,
  decide,
  deployedStage,
  isDeployedPath,
  issueTitle,
  type MergedPullRequest,
  renderIssue,
  SKIP_LABEL,
  testedPullRequests,
  testMarker,
} from './plan.js';

const pr = (over: Partial<MergedPullRequest> = {}): MergedPullRequest => ({
  number: 634,
  title:
    '[#599] fix(instructor-portal): My Courses shows placeholder figures as real workload numbers',
  url: 'https://github.com/o/r/pull/634',
  labels: [],
  files: ['packages/websites/instructor-portal/src/routes/index.tsx'],
  mergeCommit: 'abc123',
  closingIssues: [599],
  ...over,
});

describe('deployedStage', () => {
  it('names the stage when the Deploy step ran', () => {
    expect(
      deployedStage([
        {
          name: 'Deploy (discava-development)',
          steps: [
            { name: 'Synthesize', conclusion: 'success' },
            { name: 'Deploy', conclusion: 'success' },
          ],
        },
      ]),
    ).toBe('discava-development');
  });

  it('is undefined when the Deploy step was skipped as stale', () => {
    expect(
      deployedStage([
        {
          name: 'Deploy (discava-development)',
          steps: [{ name: 'Deploy', conclusion: 'skipped' }],
        },
      ]),
    ).toBeUndefined();
  });

  it('ignores jobs that are not the deploy job', () => {
    expect(
      deployedStage([
        { name: 'Other', steps: [{ name: 'Deploy', conclusion: 'success' }] },
      ]),
    ).toBeUndefined();
  });
});

describe('isDeployedPath', () => {
  it.each([
    'docs/src/content/docs/index.md',
    'specs/2026-x/tasks.md',
    '.github/workflows/ci.yml',
    'packages/e2e/src/scenarios/a.e2e.ts',
    'packages/tooling/agent/src/x.ts',
    'packages/apis/core-api/src/router.test.ts',
    'packages/websites/student-portal/src/a.test.tsx',
    'packages/infra/src/stacks/__snapshots__/x.snap',
    'README.md',
    '.gitignore',
  ])('%s is not deployed', (path) => {
    expect(isDeployedPath(path)).toBe(false);
  });

  it.each([
    'packages/apis/core-api/src/router.ts',
    'packages/websites/student-portal/src/routes/index.tsx',
    'packages/infra/src/stacks/data-stack.ts',
    'packages/databases/core-table/src/entities/course.ts',
    'pnpm-lock.yaml',
  ])('%s is deployed', (path) => {
    expect(isDeployedPath(path)).toBe(true);
  });
});

describe('changeKind', () => {
  it('is ui when a portal or shared component changes', () => {
    expect(
      changeKind([
        'packages/apis/core-api/src/router.ts',
        'packages/common/shadcn/src/components/button.tsx',
      ]),
    ).toBe('ui');
  });

  it('is backend when only portal tests change', () => {
    expect(
      changeKind([
        'packages/apis/core-api/src/router.ts',
        'packages/websites/student-portal/src/a.test.tsx',
      ]),
    ).toBe('backend');
  });
});

describe('decide', () => {
  it('tests a deployed change', () => {
    expect(decide(pr(), new Set())).toEqual({ test: true });
  });

  it('skips one that already has an issue', () => {
    expect(decide(pr(), new Set([634])).test).toBe(false);
  });

  it('skips one labelled to skip', () => {
    expect(decide(pr({ labels: [SKIP_LABEL] }), new Set()).test).toBe(false);
  });

  it('skips one that changes nothing deployed', () => {
    expect(
      decide(
        pr({ files: ['docs/a.md', '.github/workflows/ci.yml'] }),
        new Set(),
      ).test,
    ).toBe(false);
  });
});

describe('testedPullRequests', () => {
  it('reads the markers', () => {
    expect(
      testedPullRequests([`${testMarker(12)}\nbody`, 'none', testMarker(7)]),
    ).toEqual(new Set([12, 7]));
  });
});

describe('issueTitle', () => {
  it('drops the [#n] prefix and type, and lower-cases the subject', () => {
    expect(issueTitle(pr())).toBe(
      'test(post-merge): verify #634 my Courses shows placeholder figures as real workload numbers',
    );
  });

  it('cuts at a word within 100 characters', () => {
    const title = issueTitle(pr({ title: `feat: ${'word '.repeat(40)}` }));
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith('word')).toBe(true);
  });
});

describe('renderIssue', () => {
  it('carries the marker and what to test, and nothing on how', () => {
    const { body } = renderIssue({
      pr: pr({ files: [...pr().files, 'docs/x.md'] }),
      stage: 'discava-development',
      deployedSha: 'def456',
      deployRunUrl: 'https://github.com/o/r/actions/runs/1',
    });
    expect(body.startsWith(testMarker(634))).toBe(true);
    expect(body).toContain('- Pull request: #634');
    expect(body).toContain('Issue it closes: #599');
    expect(body).toContain('**UI change**');
    expect(body).toContain('Deployed files it changes (1)');
    expect(body).not.toContain('docs/x.md');
    expect(body).toContain('deployed to `discava-development` at `def456`');
    // The instructions are the agent's own prompt, not the issue's.
    expect(body).not.toContain('## Instructions for the agent');
    expect(body).not.toContain('DISCAVA_');
  });
});
