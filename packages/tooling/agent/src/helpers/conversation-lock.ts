/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Anyone can comment on a public repository's issues and pull requests, and
// the agents read those comments while holding credentials (AWS, the test
// users, a token that can push). A locked conversation takes comments only
// from collaborators with write access, the agent's own token among them, so
// everything an agent is handed is locked.

type Gh = (args: string[]) => string;

/** Locks an issue or pull request, unless it is locked already. */
export const lockConversation = (
  repository: string,
  number: number | string,
  gh: Gh,
): void => {
  const path = `repos/${repository}/issues/${number}`;
  if (gh(['api', path, '--jq', '.locked']).trim() !== 'true') {
    gh(['api', '-X', 'PUT', `${path}/lock`]);
  }
};

/** The number at the end of an issue or pull request URL. */
export const numberFromUrl = (url: string): string | undefined =>
  /\/(?:issues|pull)\/(\d+)\/?$/.exec(url.trim())?.[1];

/**
 * Locks an issue just opened for an agent, and the conversations it points
 * the agent at. If any can't be locked, the agent's label comes off the issue,
 * so the agent never picks it up open. True when everything was locked.
 */
export const lockAgentIssue = ({
  repository,
  issueUrl,
  label,
  alsoLock = [],
  gh,
  log,
}: {
  repository: string;
  issueUrl: string;
  label: string;
  alsoLock?: number[];
  gh: Gh;
  log: (message: string) => void;
}): boolean => {
  const issue = numberFromUrl(issueUrl);
  try {
    if (!issue) {
      throw new Error(`no issue number in ${issueUrl}`);
    }
    for (const number of [issue, ...alsoLock]) {
      lockConversation(repository, number, gh);
    }
    return true;
  } catch (error) {
    const what = [issueUrl, ...alsoLock.map((n) => `#${n}`)].join(' and ');
    log(
      `::warning::Could not lock ${what} (${(error as Error).message}); removed the ${label} label instead. Lock it, then add the label back.`,
    );
    if (issue) {
      gh(['issue', 'edit', issue, '--remove-label', label]);
    }
    return false;
  }
};
