/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The Cognito groups Discava gives roles through.
export type Group = 'student' | 'instructor' | 'admin';

// A signed-in user's groups, from their ID token's `cognito:groups` claim (an
// array in Cognito's tokens and the local OIDC server's alike).
export const groupsOf = (
  profile: Record<string, unknown> | undefined,
): string[] => {
  const groups = profile?.['cognito:groups'];
  return Array.isArray(groups)
    ? groups.filter((group): group is string => typeof group === 'string')
    : [];
};

export const isInGroup = (
  profile: Record<string, unknown> | undefined,
  group: Group,
): boolean => groupsOf(profile).includes(group);
