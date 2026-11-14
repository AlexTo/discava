/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closedIssue, specFolders } from './discover.js';
import { decide } from './gate.js';
import { AGENT_LABEL, markerFolder } from './issue.js';
import { planIssue } from './plan-issue.js';

// Run by .github/workflows/agent-issues.yml when a pull request merges: opens
// the next implementation issue for the implementing agent (see gate.ts for
// which merges count, tasks.ts for how a feature is split into issues).
// DRY_RUN=true prints the issue instead of creating it.

const gh = (args: string[]): string =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

const notice = (message: string) => console.log(`::notice::${message}`);

const main = () => {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !repository) {
    throw new Error('GITHUB_EVENT_PATH and GITHUB_REPOSITORY must be set');
  }
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const dryRun = process.env.DRY_RUN === 'true';
  const pr = JSON.parse(readFileSync(eventPath, 'utf8')).pull_request as {
    number: number;
    body: string | null;
    merged: boolean;
    labels: { name: string }[];
    head: { ref: string };
  };

  const decision = decide({
    merged: pr.merged === true,
    labels: pr.labels.map((label) => label.name),
    headRef: pr.head.ref,
  });
  if (decision.kind === 'ignore') {
    notice(`No issue created: ${decision.reason}`);
    return;
  }

  // The spec folder: the one the agent's issue named, else the one the pull
  // request changed.
  const folders: string[] = [];
  const linked = closedIssue(pr.body);
  if (decision.kind === 'implementation' && linked !== undefined) {
    const body = JSON.parse(
      gh(['issue', 'view', String(linked), '--json', 'body']),
    ).body as string;
    const folder = markerFolder(body);
    if (folder) {
      folders.push(folder);
    }
  }
  if (folders.length === 0) {
    const files = gh([
      'api',
      `repos/${repository}/pulls/${pr.number}/files`,
      '--paginate',
      '--jq',
      '.[].filename',
    ])
      .split('\n')
      .filter(Boolean);
    folders.push(...specFolders(files));
  }
  const withTasks = folders.filter((folder) =>
    existsSync(join(root, 'specs', folder, 'tasks.md')),
  );
  if (withTasks.length === 0) {
    notice('No issue created: no spec folder with a tasks.md was found');
    return;
  }

  const templateMd = readFileSync(
    join(root, '.github/ISSUE_TEMPLATE/implement-phase.md'),
    'utf8',
  );
  const existingIssueBodies = (
    JSON.parse(
      gh([
        'issue',
        'list',
        '--label',
        AGENT_LABEL,
        '--state',
        'all',
        '--limit',
        '500',
        '--json',
        'body',
      ]),
    ) as { body: string }[]
  ).map(({ body }) => body);

  for (const folder of withTasks) {
    const read = (file: string) =>
      readFileSync(join(root, 'specs', folder, file), 'utf8');
    const plan = planIssue({
      folder,
      tasksMd: read('tasks.md'),
      specMd: read('spec.md'),
      templateMd,
      existingIssueBodies,
    });
    if (plan.action === 'skip') {
      notice(`No issue created: ${plan.reason}`);
      continue;
    }
    if (dryRun) {
      console.log(`${plan.issue.title}\n\n${plan.issue.body}`);
      continue;
    }
    const bodyFile = join(
      mkdtempSync(join(tmpdir(), 'agent-issue-')),
      'body.md',
    );
    writeFileSync(bodyFile, plan.issue.body);
    const url = gh([
      'issue',
      'create',
      '--title',
      plan.issue.title,
      '--body-file',
      bodyFile,
      '--label',
      AGENT_LABEL,
    ]).trim();
    notice(`Created ${url}`);
  }
};

main();
