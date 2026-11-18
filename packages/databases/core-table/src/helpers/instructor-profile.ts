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
  type NotificationTransactionItems,
  transactionEntities,
} from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `instructorProfile` and `profileHandleClaim`, so the
// rules that span the two are kept in one place (checked by
// checkProfileHandleClaimsConsistent):
// - a profile and the claim on its handle are created in one transaction,
//   each conditioned on not existing, so two instructors never share a handle
//   and an instructor never has two profiles.

const CLAIMED = 'ConditionalCheckFailed';
const FALLBACK_HANDLE = 'instructor';
const FALLBACK_DISPLAY_NAME = 'Discava instructor';
const RANDOM_CANDIDATES = 4;
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
    const failed = (results ?? []).map(
      (result: { code?: string } | undefined) => result?.code === CLAIMED,
    );
    if (failed[0]) {
      return { status: 'exists' };
    }
    if (!failed[1]) {
      throw new Error('The instructor profile could not be created');
    }
  }
  return { status: 'handle-taken' };
};
