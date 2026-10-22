/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createUserEntity } from '../entities/user.js';
import { isConditionalCheckFailed } from './errors.js';

type UserEntity = Awaited<ReturnType<typeof createUserEntity>>;

// Who a user is, as Cognito knows them, kept in the core table so people can
// be shown by name (#230). Roles aren't part of it: they stay in Cognito
// groups and reach the APIs in every token.
export interface IUserProfile {
  userId: string;
  email?: string;
  givenName?: string;
  familyName?: string;
}

const PROFILE_FIELDS = ['email', 'givenName', 'familyName'] as const;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

// The profile in a Cognito trigger's userAttributes, or in local dev the local
// OIDC server's token claims, which use the same names. Undefined without a
// sub, since that's the record's key.
export const userProfileFrom = (
  attributes: Record<string, unknown>,
): IUserProfile | undefined => {
  const userId = asString(attributes.sub);
  if (!userId) {
    return undefined;
  }
  return {
    userId,
    email: asString(attributes.email),
    givenName: asString(attributes.given_name),
    familyName: asString(attributes.family_name),
  };
};

export const profileChanged = (
  existing: Partial<IUserProfile> | null | undefined,
  profile: IUserProfile,
): boolean =>
  !existing ||
  PROFILE_FIELDS.some((field) => existing[field] !== profile[field]);

// Brings a user's record in line with their profile. Reads first and writes
// only when something changed: the pre token generation trigger runs on every
// sign-in and token refresh, so an unchanged user costs a read, not a write
// (nor a stream record).
export const syncUserProfile = async (
  user: UserEntity,
  profile: IUserProfile,
): Promise<'created' | 'updated' | 'unchanged'> => {
  const { userId } = profile;
  const { data: existing } = await user.get({ userId }).go();
  if (!profileChanged(existing, profile)) {
    return 'unchanged';
  }

  const set = Object.fromEntries(
    PROFILE_FIELDS.filter((field) => profile[field] !== undefined).map(
      (field) => [field, profile[field]],
    ),
  );
  const removed = PROFILE_FIELDS.filter(
    (field) => profile[field] === undefined && existing?.[field] !== undefined,
  );

  if (!existing) {
    try {
      await user.create({ userId, ...set }).go();
      return 'created';
    } catch (error) {
      // Another sign-in created it first; fall through and update that one.
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }
  }

  const patch = user.patch({ userId }).set(set);
  await (removed.length ? patch.remove(removed) : patch).go();
  return 'updated';
};
