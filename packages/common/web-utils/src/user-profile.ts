/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { User } from 'oidc-client-ts';

type UserProfile = User['profile'];

export interface UserIdentity {
  displayName: string;
  initials: string;
}

const getClaim = (
  profile: UserProfile | undefined,
  claim: keyof UserProfile,
) => {
  const value = profile?.[claim];
  return typeof value === 'string' ? value.trim() : '';
};

const getInitials = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';

  const first = parts[0]?.charAt(0) ?? '';
  const last =
    parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return `${first}${last}`.toUpperCase();
};

export const getUserIdentity = (
  profile: UserProfile | undefined,
): UserIdentity => {
  const givenName = getClaim(profile, 'given_name');
  const familyName = getClaim(profile, 'family_name');
  const displayName = `${givenName} ${familyName}`.trim();

  return {
    displayName,
    initials: getInitials(displayName),
  };
};
