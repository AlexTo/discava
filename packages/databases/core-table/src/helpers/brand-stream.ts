/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which of the core table's stream records mean the platform brand changed:
 * the record created by the first save, and each later save. The handler
 * reads the current record, not the image, so the filter only needs to say
 * "something changed".
 *
 * The one definition the `brand-publishing` entry in STREAM_FEATURES is built
 * from.
 */
export const BRAND_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: ['platformBrand'] },
  { eventName: 'MODIFY', image: 'NewImage', entities: ['platformBrand'] },
];

/** A stream record, as GetRecords returns it and a Lambda receives it. */
export interface BrandStreamRecord {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, { S?: string } | undefined>;
    OldImage?: Record<string, { S?: string } | undefined>;
  };
}

/** Whether a stream record passes BRAND_STREAM_FILTERS. */
export const matchesBrandStreamFilters = (record: BrandStreamRecord): boolean =>
  BRAND_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );
