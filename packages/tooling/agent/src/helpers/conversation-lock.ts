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
 * Hands an issue just opened (unlabelled) to an agent: locks it and the
 * conversations it points the agent at, and only then adds the agent's label,
 * so the agent never picks it up while anyone can still comment. If anything
 * can't be locked the label is never added. A label the workflow token adds
 * starts no workflow. True when the issue was handed over.
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
  const others = [...new Set(alsoLock)];
  try {
    if (!issue) {
      throw new Error(`no issue number in ${issueUrl}`);
    }
    for (const number of [issue, ...others]) {
      lockConversation(repository, number, gh);
    }
  } catch (error) {
    const what = [issueUrl, ...others.map((n) => `#${n}`)].join(', ');
    log(
      `::warning::Could not lock ${what} (${(error as Error).message}), so the ${label} label was not added. Lock them, then add the label.`,
    );
    return false;
  }
  gh(['issue', 'edit', issue, '--add-label', label]);
  return true;
};
