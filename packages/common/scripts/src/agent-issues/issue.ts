/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TaskGroup } from './tasks.js';

// Builds the implementation issue handed to the agent. The standing
// instructions come from the issue template, so they live in one place.

export const AGENT_LABEL = 'openhands';

const INSTRUCTIONS_HEADING = '## Instructions for the agent';

export const issueMarker = (folder: string, group: number): string =>
  `<!-- agent-issue spec:${folder} group:${group} -->`;

export const markerFolder = (issueBody: string): string | undefined =>
  /<!-- agent-issue spec:(\S+) group:\d+ -->/.exec(issueBody)?.[1];

/** "20261114-120542-assignment-submissions" -> "assignment-submissions". */
export const featureName = (folder: string): string =>
  folder.replace(/^\d{8}-\d{6}-/, '').replace(/^\d{3}-/, '');

/** The `**Parent issue**: #102` line of spec.md, if it has one. */
export const parentIssue = (specMd: string): number | undefined => {
  const match = /\*\*Parent issue\*\*:\s*#(\d+)/.exec(specMd);
  return match ? Number(match[1]) : undefined;
};

// The bullets under "Instructions for the agent" in the issue template, with
// `#<parent>` filled in; the bullet about the parent is dropped when the spec
// names none.
export const instructionsFrom = (
  templateMd: string,
  parent: number | undefined,
): string => {
  const start = templateMd.indexOf(INSTRUCTIONS_HEADING);
  if (start < 0) {
    throw new Error(`The issue template has no "${INSTRUCTIONS_HEADING}"`);
  }
  const rest = templateMd.slice(start + INSTRUCTIONS_HEADING.length);
  const next = rest.search(/^## /m);
  const section = (next < 0 ? rest : rest.slice(0, next)).trim();
  return section
    .split('\n')
    .filter((line) => parent !== undefined || !line.includes('#<parent>'))
    .map((line) => line.replaceAll('#<parent>', `#${parent}`))
    .join('\n');
};

export interface RenderedIssue {
  title: string;
  body: string;
}

export const renderIssue = ({
  folder,
  group,
  parent,
  templateMd,
}: {
  folder: string;
  group: TaskGroup;
  parent: number | undefined;
  templateMd: string;
}): RenderedIssue => {
  const ids = group.tasks.map((task) => task.id);
  const phases = group.phases
    .map((phase) => `Phase ${phase.number}: ${phase.title}`)
    .join('; ');
  const body = [
    issueMarker(folder, group.index),
    '',
    '## Spec',
    '',
    `- Spec folder: \`specs/${folder}/\` (read \`spec.md\`, \`plan.md\`, \`tasks.md\`, \`data-model.md\` and \`contracts/\`)`,
    ...(parent === undefined ? [] : [`- Parent issue: #${parent}`]),
    '',
    '## Scope',
    '',
    `Tasks \`${ids[0]}\` to \`${ids[ids.length - 1]}\` of \`tasks.md\` (${phases}). Do not start tasks outside this range.`,
    '',
    INSTRUCTIONS_HEADING,
    '',
    instructionsFrom(templateMd, parent),
    '',
  ].join('\n');
  return {
    title: `feat(${featureName(folder)}): ${group.title}`,
    body,
  };
};
