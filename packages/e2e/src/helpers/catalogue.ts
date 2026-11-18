/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import {
  type CourseCatalogue,
  categoryWrites,
  courseCatalogueWrites,
  createCoreTableService,
} from '@discava/core-table';

// Setting up the catalogue through core-table's own write helpers, the ones
// the APIs call, until the instructor and admin procedures exist to do it
// through the portals.

process.env.LOCAL_DEV = 'true';

// A UUID v7: the time in the first 48 bits, random for the rest.
const uuidV7 = () => {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Creates a category; `name` must be unique to the scenario. */
export const createCategory = async (name: string) => {
  const service = await createCoreTableService();
  return categoryWrites.create(service, { categoryId: uuidV7(), name });
};

/** The category with this name, created when there is none yet. */
export const ensureCategory = async (name: string) => {
  const service = await createCoreTableService();
  const { data } = await service.entities.category.query
    .primary({})
    .go({ pages: 'all' });
  const existing = data.find(
    (category) => category.name.toLowerCase() === name.toLowerCase(),
  );
  return existing ?? createCategory(name);
};

/** Archives a category; its courses keep pointing at it. */
export const archiveCategory = async (categoryId: string) => {
  const service = await createCoreTableService();
  return categoryWrites.archive(service, { categoryId });
};

/** Replaces a course's catalogue fields. */
export const setCourseCatalogue = async (
  courseId: string,
  catalogue: CourseCatalogue,
) => {
  const service = await createCoreTableService();
  await courseCatalogueWrites(service, { courseId, ...catalogue });
};
