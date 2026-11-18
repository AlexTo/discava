/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import {
  categoryNameKey,
  categorySlug,
  normaliseCategoryName,
} from './catalogue.js';
import {
  isConditionalCheckFailed,
  NameConflictError,
  NotFoundError,
  SlugUnavailableError,
  VersionConflictError,
} from './errors.js';
import { transactionEntities } from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `category` and `categoryClaim`: every writer calls these,
// so the rules that span records are kept in one place (checked by
// checkCategoryClaimsConsistent):
// - a category, its slug claim and its name claim are created in one
//   transaction, each claim conditioned on not existing, so two categories
//   can never share a name (ignoring case and spacing) or a slug;
// - a rename moves the name claim and never touches the slug, which is
//   immutable because addresses and links are built from it;
// - nothing deletes a category: archiving hides it from new choices.

const MAX_SLUG_ATTEMPTS = 5;
const CLAIMED = 'ConditionalCheckFailed';

const slugClaim = (slug: string) => `slug#${slug}`;
const nameClaim = (name: string) => `name#${categoryNameKey(name)}`;

const claimedSlugs = async (service: CoreTable, base: string) => {
  const { data } = await service.entities.categoryClaim.query
    .primary({})
    .begins({ claim: slugClaim(base) })
    .go({ pages: 'all' });
  return new Set(data.map(({ claim }) => claim));
};

// The first of `base`, `base-2`, `base-3`... whose claim is not in `taken`.
const firstFreeSlug = (base: string, taken: Set<string>) => {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(slugClaim(slug))) {
      return slug;
    }
  }
};

export interface CategoryCreate {
  /** A UUID v7, minted by the caller. */
  categoryId: string;
  name: string;
}

export const categoryWrites = {
  /**
   * Creates a category. The slug is derived from the name, with a numeric
   * suffix when another category already has it. Throws NameConflictError
   * when another category has the name, and SlugUnavailableError when racing
   * creates keep taking the slug.
   */
  async create(service: CoreTable, { categoryId, name }: CategoryCreate) {
    const displayName = normaliseCategoryName(name);
    const base = categorySlug(displayName);
    const { category, categoryClaim } = transactionEntities(service);

    let slug = base;
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const { canceled, data: results } = await service.transaction
        .write(() => [
          category
            .create({ categoryId, name: displayName, slug, status: 'active' })
            .commit(),
          categoryClaim.create({ claim: slugClaim(slug), categoryId }).commit(),
          categoryClaim
            .create({ claim: nameClaim(displayName), categoryId })
            .commit(),
        ])
        .go();
      if (!canceled) {
        return {
          categoryId,
          name: displayName,
          slug,
          status: 'active' as const,
        };
      }
      const failed = (results ?? []).map(
        (result: { code?: string } | undefined) => result?.code === CLAIMED,
      );
      // The name decides first: a taken name is a conflict whatever the slug.
      if (failed[2]) {
        throw new NameConflictError(
          `A category named "${displayName}" already exists`,
        );
      }
      if (!failed[1]) {
        // Not a claim: the category id itself exists, or another failure.
        throw new VersionConflictError('The category could not be created');
      }
      slug = firstFreeSlug(base, await claimedSlugs(service, base));
    }
    throw new SlugUnavailableError();
  },

  /**
   * Renames a category; its slug stays. A change of case or spacing only
   * patches `name`: the name claim is the same item, which DynamoDB won't
   * create and delete in one transaction. Throws NotFoundError for an
   * unknown category and NameConflictError for a name another category has.
   */
  async rename(
    service: CoreTable,
    { categoryId, name }: { categoryId: string; name: string },
  ) {
    const displayName = normaliseCategoryName(name);
    const { data: current } = await service.entities.category
      .get({ categoryId })
      .go();
    if (!current) {
      throw new NotFoundError('Category not found');
    }
    const { category, categoryClaim } = transactionEntities(service);
    const patchName = (entity: typeof category) =>
      entity
        .patch({ categoryId })
        .set({ name: displayName })
        .where((attr, op) => op.eq(attr.name, current.name));

    if (nameClaim(displayName) === nameClaim(current.name)) {
      try {
        await service.entities.category
          .patch({ categoryId })
          .set({ name: displayName })
          .where((attr, op) => op.eq(attr.name, current.name))
          .go();
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          throw new VersionConflictError();
        }
        throw error;
      }
      return { ...current, name: displayName };
    }

    const { canceled, data: results } = await service.transaction
      .write(() => [
        patchName(category).commit(),
        categoryClaim
          .create({ claim: nameClaim(displayName), categoryId })
          .commit(),
        categoryClaim.delete({ claim: nameClaim(current.name) }).commit(),
      ])
      .go();
    if (canceled) {
      const failed = (results ?? []).map(
        (result: { code?: string } | undefined) => result?.code === CLAIMED,
      );
      if (failed[1]) {
        throw new NameConflictError(
          `A category named "${displayName}" already exists`,
        );
      }
      throw new VersionConflictError();
    }
    return { ...current, name: displayName };
  },

  /**
   * Archives a category. Courses keep pointing at it. Archiving an archived
   * category changes nothing. Throws NotFoundError for an unknown one.
   */
  async archive(service: CoreTable, { categoryId }: { categoryId: string }) {
    try {
      const { data } = await service.entities.category
        .patch({ categoryId })
        .set({ status: 'archived' })
        .where((attr, op) => op.eq(attr.status, 'active'))
        .go({ response: 'all_new' });
      return data;
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }
    const { data: existing } = await service.entities.category
      .get({ categoryId })
      .go();
    if (!existing) {
      throw new NotFoundError('Category not found');
    }
    return existing;
  },
};
