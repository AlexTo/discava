/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Which merged pull requests get a test issue once the Deploy workflow has put
// them on a stage, and what that issue says: only what to test. How to test
// it is the test agent's own standing prompt, which nobody who can edit an
// issue can change. The test agent (OpenHands polls
// for the `openhands-test` label) then exercises the change on the deployed
// stack: the portals with Playwright, the APIs with the test users' tokens,
// and the data the change wrote.

export const TEST_LABEL = 'openhands-test';
/** A pull request carrying this label never gets a test issue. */
export const SKIP_LABEL = 'skip-deploy-test';
/** The stage test issues are opened for. */
export const DEFAULT_TEST_STAGE = 'discava-development';

export const MARKER_PREFIX = '<!-- post-merge-test pr:';

export const testMarker = (pr: number): string => `${MARKER_PREFIX}${pr} -->`;

/** The pull request numbers named by these issue bodies' markers. */
export const testedPullRequests = (issueBodies: string[]): Set<number> => {
  const tested = new Set<number>();
  for (const body of issueBodies) {
    for (const match of body.matchAll(/<!-- post-merge-test pr:(\d+) -->/g)) {
      tested.add(Number(match[1]));
    }
  }
  return tested;
};

export interface DeployJob {
  name: string;
  steps?: { name: string; conclusion: string | null }[];
}

// deploy.yml's job is named "Deploy (<stage>)", and its "Deploy" step is
// skipped when the commit was no longer main's latest: the job succeeds but
// nothing reached the stage.
const DEPLOY_JOB = /^Deploy \((.+)\)$/;

/** The stage a Deploy run's jobs actually deployed, if any. */
export const deployedStage = (jobs: DeployJob[]): string | undefined => {
  for (const job of jobs) {
    const stage = DEPLOY_JOB.exec(job.name)?.[1];
    const step = job.steps?.find((s) => s.name === 'Deploy');
    if (stage && step?.conclusion === 'success') {
      return stage;
    }
  }
  return undefined;
};

// Paths that never reach a deployed stack: there is nothing to test on it.
const NOT_DEPLOYED: RegExp[] = [
  /^docs\//,
  /^specs\//,
  /^\.github\//,
  /^\.specify\//,
  /^\.claude\//,
  /^\.husky\//,
  /^graphify-out\//,
  /^tmp\//,
  /^scripts\//,
  /^packages\/e2e\//,
  /^packages\/tooling\//,
  /(^|\/)__snapshots__\//,
  /\.(test|spec|e2e)\.tsx?$/,
  /(^|\/)test-setup\.ts$/,
  /\.md$/,
  /(^|\/)(LICENSE|NOTICE)$/,
  /^\.[^/]+$/,
];

export const isDeployedPath = (path: string): boolean =>
  !NOT_DEPLOYED.some((pattern) => pattern.test(path));

// A portal or the components they share: worth clicking through.
const UI_PATHS = [/^packages\/websites\//, /^packages\/common\/shadcn\//];

export type ChangeKind = 'ui' | 'backend';

export const changeKind = (files: string[]): ChangeKind =>
  files.some(
    (file) => isDeployedPath(file) && UI_PATHS.some((p) => p.test(file)),
  )
    ? 'ui'
    : 'backend';

export interface MergedPullRequest {
  number: number;
  title: string;
  url: string;
  labels: string[];
  files: string[];
  mergeCommit: string;
  closingIssues: number[];
}

export type Decision = { test: true } | { test: false; reason: string };

export const decide = (
  pr: MergedPullRequest,
  tested: Set<number>,
): Decision => {
  if (tested.has(pr.number)) {
    return { test: false, reason: `#${pr.number} already has a test issue` };
  }
  if (pr.labels.includes(SKIP_LABEL)) {
    return { test: false, reason: `#${pr.number} is labelled ${SKIP_LABEL}` };
  }
  if (!pr.files.some(isDeployedPath)) {
    return {
      test: false,
      reason: `#${pr.number} changes nothing that is deployed (docs, specs, tests, tooling or CI only)`,
    };
  }
  return { test: true };
};

// commitlint's header-max-length: the agent may reuse the issue's title.
const MAX_TITLE_LENGTH = 100;

/**
 * "test(post-merge): verify #634 my courses shows placeholder figures…", cut
 * to 100 characters at a word. The pull request's own `[#n]` prefix and
 * Conventional Commit type are dropped.
 */
export const issueTitle = (pr: { number: number; title: string }): string => {
  const prefix = `test(post-merge): verify #${pr.number} `;
  const subject = pr.title
    .replace(/^\[#\d+\]\s*/, '')
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '')
    .replace(/\.+$/, '')
    .trim();
  const lowered = /^[A-Z][a-z]/.test(subject)
    ? subject[0].toLowerCase() + subject.slice(1)
    : subject;
  const room = MAX_TITLE_LENGTH - prefix.length;
  if (lowered.length <= room) {
    return `${prefix}${lowered}`.trimEnd();
  }
  const cut = lowered.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  return `${prefix}${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}`.trimEnd();
};

const MAX_LISTED_FILES = 60;

export interface IssueContext {
  pr: MergedPullRequest;
  stage: string;
  deployedSha: string;
  deployRunUrl: string | undefined;
}

export const renderIssue = ({
  pr,
  stage,
  deployedSha,
  deployRunUrl,
}: IssueContext): { title: string; body: string } => {
  const kind = changeKind(pr.files);
  const deployed = pr.files.filter(isDeployedPath);
  const listed = deployed.slice(0, MAX_LISTED_FILES);
  const howTo =
    kind === 'ui'
      ? 'It changes a portal: sign in as the user the change is for and click through the flow with Playwright, then call the APIs behind it and check the stored data.'
      : "It changes no portal: call the APIs (or trigger the event) the change affects, then check the stored data and the Lambdas' logs.";
  const body = [
    testMarker(pr.number),
    '',
    '## What to test',
    '',
    `- Pull request: #${pr.number} (${pr.title})`,
    ...(pr.closingIssues.length > 0
      ? [
          `- Issue it closes: ${pr.closingIssues.map((n) => `#${n}`).join(', ')}`,
        ]
      : []),
    `- Merged as \`${pr.mergeCommit}\`, deployed to \`${stage}\` at \`${deployedSha}\`${deployRunUrl ? ` ([Deploy run](${deployRunUrl}))` : ''}`,
    `- Kind: **${kind === 'ui' ? 'UI change' : 'backend change or fix'}**. ${howTo}`,
    '',
    `<details><summary>Deployed files it changes (${deployed.length})</summary>`,
    '',
    ...listed.map((file) => `- \`${file}\``),
    ...(deployed.length > listed.length
      ? [`- … and ${deployed.length - listed.length} more`]
      : []),
    '',
    '</details>',
    '',
  ].join('\n');
  return { title: issueTitle(pr), body };
};
