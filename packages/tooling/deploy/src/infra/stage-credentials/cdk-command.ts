/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export function buildCdkCommand(
  action: string,
  remainingArgs: string[],
): string[] {
  const hasRequireApproval = remainingArgs.some(
    (a) => a === '--require-approval' || a.startsWith('--require-approval='),
  );
  const defaults =
    action === 'destroy' || hasRequireApproval
      ? []
      : ['--require-approval=never'];
  return ['cdk', action, ...defaults, ...remainingArgs];
}
