/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { BRAND_NAME_MAX_LENGTH } from '@discava/common-branding/brand';
import { brandPalette } from '@discava/common-branding/colour';
import {
  BRAND_IMAGE_KINDS,
  type BrandImageKind,
  isBrandImageKey,
} from '@discava/common-branding/image-rules';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// Platform branding: the one brand record an administrator saves, which the
// portals and public pages show. Its fields are what the brand's readers
// assume: a name that fits a header, a colour with readable text, image keys
// of the right kind, and a revision that counts saves.

const KEY_FIELDS = {
  logo: 'logoKey',
  icon: 'iconKey',
  'share-image': 'shareImageKey',
} as const satisfies Record<BrandImageKind, string>;

// At most one record. When present, each field is within its rule and the
// revision and last change are recorded.
export const checkPlatformBrandShape = (
  snapshot: TableSnapshot,
): Violation[] => {
  const brands = snapshot.platformBrands;
  if (brands.length > 1) {
    return [
      violation(
        'platform-brand-shape',
        {},
        `${brands.length} brand records, but there is only one brand`,
      ),
    ];
  }
  const [brand] = brands;
  if (!brand) {
    return [];
  }
  const problems: string[] = [];
  if (brand.name !== undefined) {
    const length = brand.name.trim().length;
    if (length < 1 || length > BRAND_NAME_MAX_LENGTH) {
      problems.push(
        `name has ${length} characters, not 1–${BRAND_NAME_MAX_LENGTH}`,
      );
    }
  }
  if (brand.colour !== undefined && !brandPalette(brand.colour).ok) {
    problems.push(`colour ${brand.colour} has no readable text colour`);
  }
  for (const kind of BRAND_IMAGE_KINDS) {
    const key = brand[KEY_FIELDS[kind]];
    if (key !== undefined && !isBrandImageKey(kind, key)) {
      problems.push(`${KEY_FIELDS[kind]} ${key} is not a ${kind} key`);
    }
  }
  if (!Number.isInteger(brand.revision) || brand.revision < 1) {
    problems.push(`revision ${brand.revision} is not a positive integer`);
  }
  if (!brand.changedBy) {
    problems.push('changedBy is not set');
  }
  if (!brand.changedAt) {
    problems.push('changedAt is not set');
  }
  return problems.map((message) =>
    violation(
      'platform-brand-shape',
      { revision: String(brand.revision) },
      message,
    ),
  );
};

export const BRANDING_CHECKS = [
  { name: 'platform-brand-shape', check: checkPlatformBrandShape },
] as const satisfies readonly Check[];
