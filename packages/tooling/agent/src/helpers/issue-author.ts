/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The workflows find the issues they opened earlier by a marker in the body.
// Anyone can open an issue on a public repository, so a marker counts only in
// an issue from an author the workflows trust.

export interface IssueSummary {
  body: string;
  /** The login of whoever opened it. */
  author: string;
  /** GitHub's `author_association`: what the author is to the repository. */
  association: string;
}

// The workflows' token opens the agents' issues; a person with write access
// may open or rewrite one by hand.
const WORKFLOW_AUTHOR = 'github-actions[bot]';
const WRITE_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** Whether an issue's marker counts: anyone can open an issue with one. */
export const isTrustedIssue = (issue: IssueSummary): boolean =>
  issue.author === WORKFLOW_AUTHOR ||
  WRITE_ASSOCIATIONS.includes(issue.association);
