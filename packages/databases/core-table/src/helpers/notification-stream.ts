/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// The entities the notification delivery step reads: a new notification
// (its email is sent) and a new broadcast (its audience is fanned out). An
// email state patch is a MODIFY, so it never loops back through the stream.
const NOTIFICATION_ENTITIES = [
  'notification',
  'notificationBroadcast',
] as const;

/**
 * Which of the core table's stream records the notification delivery step
 * handles: an INSERT of a `notification` or `notificationBroadcast`.
 * ElectroDB stores each record's entity name in `__edb_e__`.
 *
 * The one definition both the deployed event source mapping's filters and
 * local dev's event runner are built from, the same pattern as
 * SEARCH_STREAM_FILTERS.
 */
export const NOTIFICATION_STREAM_FILTERS: readonly {
  eventName: 'INSERT';
  image: 'NewImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: NOTIFICATION_ENTITIES },
];

/** A stream record, as GetRecords returns it and a Lambda receives it. */
export interface NotificationStreamRecord {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, { S?: string } | undefined>;
    OldImage?: Record<string, { S?: string } | undefined>;
  };
}

/** Whether a stream record passes NOTIFICATION_STREAM_FILTERS. */
export const matchesNotificationStreamFilters = (
  record: NotificationStreamRecord,
): boolean =>
  NOTIFICATION_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );
