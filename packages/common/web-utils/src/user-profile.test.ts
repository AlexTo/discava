/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { User } from 'oidc-client-ts';
import { getUserIdentity } from './user-profile';

type UserProfile = User['profile'];

const profile = (claims: Partial<UserProfile>) => claims as UserProfile;

describe('getUserIdentity', () => {
  it('uses given and family names with both initials', () => {
    expect(
      getUserIdentity(
        profile({
          given_name: 'Ada',
          family_name: 'Lovelace',
        }),
      ),
    ).toEqual({ displayName: 'Ada Lovelace', initials: 'AL' });
  });

  it('handles an unavailable profile', () => {
    expect(getUserIdentity(undefined)).toEqual({
      displayName: '',
      initials: '',
    });
  });
});
