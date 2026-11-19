/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomInt } from 'node:crypto';
import {
  DISPLAY_NAME_MAX,
  HANDLE_MAX,
  HANDLE_MIN,
} from '../entities/instructor-profile.js';
import type { createCoreTableService } from '../service.js';
import {
  failedAt,
  failedConditions,
  hasTransactionConflict,
} from './errors.js';
import {
  type NotificationTransactionItems,
  transactionEntities,
} from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `instructorProfile` and `profileHandleClaim`, so the
// rules that span the two are kept in one place (checked by
// checkProfileHandleClaimsConsistent):
// - a profile and the claim on its handle are created in one transaction,
//   each conditioned on not existing, so two instructors never share a handle
//   and an instructor never has two profiles;
// - a handle change creates the new claim, deletes the old one and moves the
//   profile's handle in one transaction, so the profile always has exactly one
//   claim;
// - every edit is conditioned on the profile's `version` and increments it.

const FALLBACK_HANDLE = 'instructor';
const FALLBACK_DISPLAY_NAME = 'Discava instructor';
const RANDOM_CANDIDATES = 4;
const MAX_CONFLICT_ATTEMPTS = 3;
const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Handles that would collide with a route or a file served beside the profiles.
export const RESERVED_HANDLES: readonly string[] = [
  'admin',
  'instructors',
  'learn',
  'search',
  'category',
  'certificates',
  'my-learning',
  'signin',
  'sitemap',
  'robots',
];

const cut = (value: string) => value.slice(0, HANDLE_MAX).replace(/-+$/, '');

/**
 * A handle derived from a person's name: lower case, ASCII, words joined by
 * hyphens, at most 30 characters. A name that leaves under 3 characters gives
 * `instructor`, and a reserved handle gets `-instructor` appended.
 */
export const handleFromName = (given?: string, family?: string): string => {
  const slug = cut(
    `${given ?? ''} ${family ?? ''}`
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
  const base = slug.length < HANDLE_MIN ? FALLBACK_HANDLE : slug;
  return RESERVED_HANDLES.includes(base)
    ? cut(`${base.slice(0, HANDLE_MAX - '-instructor'.length)}-instructor`)
    : base;
};

const randomSuffix = () =>
  Array.from(
    { length: 4 },
    () => RANDOM_ALPHABET[randomInt(RANDOM_ALPHABET.length)],
  ).join('');

/**
 * The handles to try for a base, in order: the base, `-2` to `-9`, then
 * `RANDOM_CANDIDATES` with four random characters. Each fits in 30 characters
 * (the base is cut to make room for the suffix).
 */
export const handleCandidates = (base: string): string[] => {
  const withSuffix = (suffix: string) =>
    `${cut(base.slice(0, HANDLE_MAX - suffix.length))}${suffix}`;
  return [
    base,
    ...Array.from({ length: 8 }, (_, i) => withSuffix(`-${i + 2}`)),
    ...Array.from({ length: RANDOM_CANDIDATES }, () =>
      withSuffix(`-${randomSuffix()}`),
    ),
  ];
};

export const defaultDisplayName = (user?: {
  givenName?: string;
  familyName?: string;
}): string => {
  const name = `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim();
  return name ? name.slice(0, DISPLAY_NAME_MAX) : FALLBACK_DISPLAY_NAME;
};

export interface InstructorProfileEnsure {
  instructorId: string;
  user?: { givenName?: string; familyName?: string };
  /** The handle to claim. */
  candidate: string;
  fields?: { displayName?: string; headline?: string; bio?: string };
  now: Date;
}

export interface InstructorProfilePatch {
  displayName?: string;
  /** An empty string removes the headline. */
  headline?: string;
  /** An empty string removes the bio. */
  bio?: string;
}

export interface InstructorProfileUpdate {
  instructorId: string;
  /** The version the caller read; the edit fails if the profile moved on. */
  version: number;
  patch: InstructorProfilePatch;
  now: Date;
}

export interface InstructorProfileHandleChange {
  instructorId: string;
  version: number;
  from: string;
  to: string;
  /** Fields to change in the same write, so one transaction holds the edit. */
  patch?: InstructorProfilePatch;
  now: Date;
}

// The profile patch for the fields of `patch` (an empty text removes its
// attribute) and the new version.
const patchProfile = (
  service: CoreTable,
  instructorId: string,
  version: number,
  patch: InstructorProfilePatch,
  now: Date,
) => {
  const { displayName, headline, bio } = patch;
  const set = {
    ...(displayName === undefined ? {} : { displayName }),
    ...(headline ? { headline } : {}),
    ...(bio ? { bio } : {}),
    version: version + 1,
    updatedAt: now.toISOString(),
  };
  const remove = [
    ...(headline === '' ? ['headline'] : []),
    ...(bio === '' ? ['bio'] : []),
  ];
  return transactionEntities(service)
    .instructorProfile.patch({ instructorId })
    .set(set as never)
    .remove(remove as never);
};

export const instructorProfileWrites = {
  /**
   * The items that create a profile and claim its handle: a profile create and
   * a claim create, each conditioned on not existing.
   */
  ensure: (
    service: CoreTable,
    { instructorId, user, candidate, fields, now }: InstructorProfileEnsure,
  ): NotificationTransactionItems => {
    const { instructorProfile, profileHandleClaim } =
      transactionEntities(service);
    const createdAt = now.toISOString();
    const displayName = fields?.displayName?.trim() || defaultDisplayName(user);
    return [
      instructorProfile
        .create({
          instructorId,
          handle: candidate,
          displayName,
          ...(fields?.headline ? { headline: fields.headline } : {}),
          ...(fields?.bio ? { bio: fields.bio } : {}),
          version: 1,
          createdAt,
          updatedAt: createdAt,
        })
        .commit(),
      profileHandleClaim
        .create({ handle: candidate, instructorId, createdAt })
        .commit(),
    ];
  },

  /**
   * The item of an edit of the profile's text fields: a patch conditioned on
   * `version`, which it increments. Cancelled as `stale` (see
   * classifyProfileCancellation) when the profile moved on or is missing.
   */
  update: (
    service: CoreTable,
    { instructorId, version, patch, now }: InstructorProfileUpdate,
  ): NotificationTransactionItems => [
    patchProfile(service, instructorId, version, patch, now)
      .where((attr, op) => op.eq(attr.version, version))
      .commit(),
  ],

  /**
   * The items of a handle change, in the order classifyProfileCancellation
   * reads: the new claim (created, so the handle must be free), the old claim
   * (deleted, so it must belong to the instructor) and the profile (its handle
   * must still be `from` and its `version` match), which may carry `patch`.
   */
  changeHandle: (
    service: CoreTable,
    {
      instructorId,
      version,
      from,
      to,
      patch,
      now,
    }: InstructorProfileHandleChange,
  ): NotificationTransactionItems => {
    const { profileHandleClaim } = transactionEntities(service);
    return [
      profileHandleClaim
        .create({ handle: to, instructorId, createdAt: now.toISOString() })
        .commit(),
      profileHandleClaim
        .delete({ handle: from })
        .where((attr, op) => op.eq(attr.instructorId, instructorId))
        .commit(),
      patchProfile(service, instructorId, version, patch ?? {}, now)
        .set({ handle: to } as never)
        .where(
          (attr, op) =>
            `${op.eq(attr.handle, from)} AND ${op.eq(attr.version, version)}`,
        )
        .commit(),
    ];
  },

  /**
   * The item that sets (or, with `photoKey` null, removes) the photo. It is not
   * conditioned on `version`, since a photo is uploaded apart from the form,
   * but it increments it, so a form read before the photo changed is stale.
   */
  setPhoto: (
    service: CoreTable,
    {
      instructorId,
      photoKey,
      now,
    }: { instructorId: string; photoKey: string | null; now: Date },
  ): NotificationTransactionItems => {
    const patch = transactionEntities(service)
      .instructorProfile.patch({ instructorId })
      .add({ version: 1 } as never);
    return [
      (photoKey
        ? patch.set({ photoKey, updatedAt: now.toISOString() } as never)
        : patch
            .set({ updatedAt: now.toISOString() } as never)
            .remove(['photoKey'] as never)
      ).commit(),
    ];
  },
};

export type ProfileCancellation = 'handle-taken' | 'stale';

/**
 * What cancelled a profile transaction, from the reason DynamoDB gave for each
 * of its items. For `changeHandle` they are the items of
 * instructorProfileWrites.changeHandle: a failed new claim is `handle-taken`;
 * a failed old claim or profile is `stale`. For `update` the one item is the
 * profile. Undefined when no condition failed (e.g. a TransactionConflict,
 * which is safe to retry).
 */
export const classifyProfileCancellation = (
  action: 'update' | 'changeHandle',
  reasons: ({ code?: string } | undefined)[],
): ProfileCancellation | undefined => {
  if (action === 'update') {
    return failedAt(reasons, 0) ? 'stale' : undefined;
  }
  if (failedAt(reasons, 0)) {
    return 'handle-taken';
  }
  return failedAt(reasons, 1, 3) ? 'stale' : undefined;
};

export type EnsureInstructorProfileResult =
  | { status: 'created'; handle: string }
  | { status: 'exists' }
  | { status: 'handle-taken' };

/**
 * Makes sure an instructor has a profile. Does nothing (`exists`) when they
 * have one. Otherwise creates it with `fields` (the display name defaults to
 * the user's name). Without a `handle` it tries `handleCandidates` in order,
 * moving on only when the claim was taken; with one it tries only that and
 * returns `handle-taken` when it is claimed. Safe to call concurrently: the
 * caller that loses a race gets `exists`.
 */
export const ensureInstructorProfile = async (
  service: CoreTable,
  instructorId: string,
  {
    fields,
    handle,
  }: {
    fields?: { displayName?: string; headline?: string; bio?: string };
    handle?: string;
  } = {},
): Promise<EnsureInstructorProfileResult> => {
  const { data: existing } = await service.entities.instructorProfile
    .get({ instructorId })
    .go();
  if (existing) {
    return { status: 'exists' };
  }
  const { data: user } = await service.entities.user
    .get({ userId: instructorId })
    .go();

  const candidates = handle
    ? [handle]
    : handleCandidates(handleFromName(user?.givenName, user?.familyName));
  for (const candidate of candidates) {
    // Two creates racing on a claim can be cancelled with a
    // TransactionConflict rather than a failed condition: nothing was
    // written, and asking again finds the claim taken or the profile there.
    for (let attempt = 1; ; attempt++) {
      const { canceled, data: results } = await service.transaction
        .write(() =>
          instructorProfileWrites.ensure(service, {
            instructorId,
            user: user ?? undefined,
            candidate,
            fields,
            now: new Date(),
          }),
        )
        .go();
      if (!canceled) {
        return { status: 'created', handle: candidate };
      }
      const failed = failedConditions(results);
      if (failed[0]) {
        return { status: 'exists' };
      }
      if (failed[1]) {
        break;
      }
      if (
        !hasTransactionConflict(results) ||
        attempt === MAX_CONFLICT_ATTEMPTS
      ) {
        throw new Error('The instructor profile could not be created');
      }
    }
  }
  return { status: 'handle-taken' };
};
