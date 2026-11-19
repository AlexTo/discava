/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which of the core table's stream records can change what instructors have
 * earned: an order as it is created or changes. Whether an order is a sale,
 * and what its refunded total is, is the handler's check, not the filter's.
 * The ledger's own entities (`earningEntry`, `earningDay`, `earningOrder`,
 * `payout`, `payoutAccount`) are not in the list, so what the handler
 * writes never comes back to it.
 *
 * The one definition the `earnings-recording` entry in STREAM_FEATURES is
 * built from.
 */
export const EARNINGS_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: ['order'] },
  { eventName: 'MODIFY', image: 'NewImage', entities: ['order'] },
];

/** A stream record, as GetRecords returns it and a Lambda receives it. */
export interface EarningsStreamRecord {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, { S?: string } | undefined>;
    OldImage?: Record<string, { S?: string } | undefined>;
  };
}

/** Whether a stream record passes EARNINGS_STREAM_FILTERS. */
export const matchesEarningsStreamFilters = (
  record: EarningsStreamRecord,
): boolean =>
  EARNINGS_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );
