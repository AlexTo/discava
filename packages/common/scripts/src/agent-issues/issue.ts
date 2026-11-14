/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TaskGroup } from './tasks.js';

// Builds the implementation issue handed to the agent. The standing
// instructions come from the issue template, so they live in one place.

export const AGENT_LABEL = 'openhands';

const INSTRUCTIONS_HEADING = '## Instructions for the agent';

// A spec folder's name. Folder names also arrive from issue bodies, which
// anyone can write, and end up in a file path: nothing that could leave
// `specs/` (no slash, no leading dot).
const FOLDER_NAME = '[A-Za-z0-9][A-Za-z0-9._-]*';

export const isSpecFolderName = (name: string): boolean =>
  new RegExp(`^${FOLDER_NAME}$`).test(name);

/** What every marker starts with, to find the issues that carry one. */
export const MARKER_PREFIX = '<!-- agent-issue spec:';

export const issueMarker = (folder: string, group: number): string =>
  `${MARKER_PREFIX}${folder} group:${group} -->`;

/** The spec folder an issue's marker names, if it has a well-formed one. */
export const markerFolder = (issueBody: string): string | undefined =>
  new RegExp(`${MARKER_PREFIX}(${FOLDER_NAME}) group:\\d+ -->`).exec(
    issueBody,
  )?.[1];

/** "20261114-120542-assignment-submissions" -> "assignment-submissions". */
export const featureName = (folder: string): string =>
  folder.replace(/^\d{8}-\d{6}-/, '').replace(/^\d{3}-/, '');

/** The `**Parent issue**: #102` line of spec.md, if it has one. */
export const parentIssue = (specMd: string): number | undefined => {
  const match = /\*\*Parent issue\*\*:\s*#(\d+)/.exec(specMd);
  return match ? Number(match[1]) : undefined;
};

// commitlint's header-max-length: the agent may reuse the issue's title for
// its pull request or a commit.
const MAX_TITLE_LENGTH = 100;
const FOUNDATIONS_SUFFIX = ' (with setup and foundations)';

// commitlint's subject-case refuses a subject that starts like a sentence.
// An acronym ("API keys") is left alone.
const lowerFirst = (text: string): string =>
  /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;

/**
 * The issue's title, as a Conventional Commit header: lower-case subject, no
 * trailing full stop, at most 100 characters (the suffix goes first, then
 * whole words off the end).
 */
export const issueTitle = (folder: string, group: TaskGroup): string => {
  const prefix = `feat(${featureName(folder)}): `;
  const subject = lowerFirst(group.title).replace(/\.+$/, '');
  const room = MAX_TITLE_LENGTH - prefix.length;
  const suffix = group.withFoundations ? FOUNDATIONS_SUFFIX : '';
  if (subject.length + suffix.length <= room) {
    return `${prefix}${subject}${suffix}`;
  }
  if (subject.length <= room) {
    return `${prefix}${subject}`;
  }
  const cut = subject.slice(0, room);
  // Back to the last whole word, unless the cut already fell at a word's end.
  const lastSpace = cut.lastIndexOf(' ');
  const whole =
    subject[room] === ' ' || lastSpace <= 0 ? cut : cut.slice(0, lastSpace);
  return `${prefix}${whole.trimEnd()}`;
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
  return { title: issueTitle(folder, group), body };
};
