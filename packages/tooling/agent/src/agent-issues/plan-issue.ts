/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  issueMarker,
  parentIssue,
  type RenderedIssue,
  renderIssue,
} from './issue.js';
import {
  groupPhases,
  nextGroup,
  openAgentTasks,
  parsePhases,
} from './tasks.js';

export type IssuePlan =
  | { action: 'create'; issue: RenderedIssue }
  | { action: 'done'; reason: string }
  // The next group already has an issue, but its tasks aren't all ticked.
  | { action: 'stalled'; reason: string; title: string; unticked: string[] };

/**
 * What to do for one spec folder: the issue for the next group with work
 * left, unless an issue for that group already exists (open or closed, with
 * or without the agent's label). Such a group is left for a person, not given
 * to the agent twice.
 */
export const planIssue = ({
  folder,
  tasksMd,
  specMd,
  templateMd,
  existingIssueBodies,
}: {
  folder: string;
  tasksMd: string;
  specMd: string;
  templateMd: string;
  existingIssueBodies: string[];
}): IssuePlan => {
  const group = nextGroup(groupPhases(parsePhases(tasksMd)));
  if (!group) {
    return { action: 'done', reason: `${folder}: no tasks left for the agent` };
  }
  const marker = issueMarker(folder, group.index);
  if (existingIssueBodies.some((body) => body.includes(marker))) {
    return {
      action: 'stalled',
      reason: `${folder}: an issue for "${group.title}" already exists but its tasks are not all ticked; a person needs to look`,
      title: group.title,
      unticked: openAgentTasks(group).map((task) => task.id),
    };
  }
  return {
    action: 'create',
    issue: renderIssue({
      folder,
      group,
      parent: parentIssue(specMd),
      templateMd,
    }),
  };
};
