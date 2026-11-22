/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type BrandFields,
  BrandFieldsSchema,
} from '@discava/common-branding/brand';
import type { createCoreTableService } from '../service.js';
import { isConditionalCheckFailed } from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `platformBrand`: the administrator's platform brand. A
// singleton, absent until the first save. A save names the revision it was
// based on and loses cleanly (BrandConflictError) if someone else saved since.
// It doesn't touch S3: attaching and detaching the images the keys name is
// the caller's job.

export interface PlatformBrandRecord extends BrandFields {
  revision: number;
  changedBy: string;
  changedByName: string;
  changedAt: string;
}

/** The record changed since the caller read it (or was created meanwhile). */
export class BrandConflictError extends Error {
  constructor() {
    super('Someone else changed the branding');
    this.name = 'BrandConflictError';
  }
}

/** A field of the brand breaks its rule; the message names the rule. */
export class BrandValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'BrandValidationError';
  }
}

// The optional fields: stored when set, removed (never stored as null) when not.
const OPTIONAL_FIELDS = [
  'name',
  'colour',
  'logoKey',
  'iconKey',
  'shareImageKey',
] as const;

// A patch returns nothing unless asked for the record as written.
const ALL_NEW = { response: 'all_new' } as const;

/** The brand as stored, with unset parts as null; undefined before the first save. */
export const getBrand = async (
  coreTable: CoreTable,
): Promise<PlatformBrandRecord | undefined> => {
  const { data } = await coreTable.entities.platformBrand.get({}).go();
  if (!data) {
    return undefined;
  }
  return {
    name: data.name ?? null,
    showNameBesideLogo: data.showNameBesideLogo,
    colour: data.colour ?? null,
    logoKey: data.logoKey ?? null,
    iconKey: data.iconKey ?? null,
    shareImageKey: data.shareImageKey ?? null,
    revision: data.revision,
    changedBy: data.changedBy,
    changedByName: data.changedByName,
    changedAt: data.changedAt,
  };
};

/**
 * Saves the whole brand. With `expectedRevision` 0 it creates the record
 * (revision 1) if none exists; otherwise it patches the record, which must
 * still be at `expectedRevision`, to the next revision. Throws
 * `BrandValidationError` before any write for a bad value and
 * `BrandConflictError` when the revision has moved.
 */
export const saveBrand = async (
  coreTable: CoreTable,
  {
    expectedRevision,
    changes,
    changedBy,
    changedByName,
    now,
  }: {
    expectedRevision: number;
    changes: BrandFields;
    changedBy: string;
    changedByName: string;
    now: string;
  },
): Promise<PlatformBrandRecord> => {
  const parsed = BrandFieldsSchema.safeParse(changes);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BrandValidationError(
      String(issue?.path[0] ?? 'brand'),
      issue?.message ?? 'The brand is not valid.',
    );
  }
  const fields = parsed.data;
  const set: Partial<Record<(typeof OPTIONAL_FIELDS)[number], string>> = {};
  const removed: (typeof OPTIONAL_FIELDS)[number][] = [];
  for (const field of OPTIONAL_FIELDS) {
    const value = fields[field];
    if (value === null) {
      removed.push(field);
    } else {
      set[field] = value;
    }
  }
  const audit = { changedBy, changedByName, changedAt: now };
  const entity = coreTable.entities.platformBrand;
  const revision = expectedRevision + 1;

  try {
    if (expectedRevision === 0) {
      await entity
        .create({
          ...set,
          showNameBesideLogo: fields.showNameBesideLogo,
          revision,
          ...audit,
        })
        .go();
    } else {
      // ElectroDB's `where` ends the chain of changes, so `remove` comes first.
      const patch = entity.patch({}).set({
        ...set,
        showNameBesideLogo: fields.showNameBesideLogo,
        revision,
        ...audit,
      });
      await (removed.length > 0 ? patch.remove(removed) : patch)
        .where((attr, op) => op.eq(attr.revision, expectedRevision))
        .go(ALL_NEW);
    }
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new BrandConflictError();
    }
    throw error;
  }
  return { ...fields, revision, ...audit };
};
