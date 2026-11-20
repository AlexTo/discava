/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { InvalidRequestError, NotFoundError } from './errors.js';
import { NOTIFICATION_TYPES } from './notification-types.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `notificationPreference`. core-api's setPreference and
// the unsubscribe route both call it, so the rule the
// `notification-preference-shape` invariant checks (a registered type that is
// not `required`) is refused before the record is written, not found after.

/**
 * Stores whether the user is emailed for a type. An unknown type is a
 * NotFoundError; a `required` or `never` type, which has no setting, an
 * InvalidRequestError. Writing the registry default is allowed. Returns the
 * type's registry entry.
 */
export const setNotificationPreference = async (
  service: CoreTable,
  userId: string,
  type: string,
  emailEnabled: boolean,
) => {
  const entry = Object.hasOwn(NOTIFICATION_TYPES, type)
    ? NOTIFICATION_TYPES[type]
    : undefined;
  if (!entry) {
    throw new NotFoundError('Unknown notification type');
  }
  if (
    entry.emailPolicy === 'required' ||
    entry.emailPolicy === 'never' ||
    entry.emailPreferenceType
  ) {
    throw new InvalidRequestError(
      'This notification type has no email setting',
    );
  }
  await service.entities.notificationPreference
    .put({ userId, type: entry.id, emailEnabled })
    .go();
  return entry;
};

/**
 * The type whose setting, unsubscribe token and label govern a type's email:
 * its `emailPreferenceType`, or the type itself.
 */
export const governingEmailType = (
  entry: (typeof NOTIFICATION_TYPES)[string],
): (typeof NOTIFICATION_TYPES)[string] =>
  (entry.emailPreferenceType &&
    Object.hasOwn(NOTIFICATION_TYPES, entry.emailPreferenceType) &&
    NOTIFICATION_TYPES[entry.emailPreferenceType]) ||
  entry;

/**
 * Whether the user is emailed for a type, the one reader of
 * `notificationPreference` for sending. An unknown type or a `never` policy is
 * false, `required` is true, a type with `emailPreferenceType` answers as that
 * type does, and otherwise the stored choice or the policy's default decides.
 */
export const isEmailEnabled = async (
  service: CoreTable,
  userId: string,
  type: string,
): Promise<boolean> => {
  const entry = Object.hasOwn(NOTIFICATION_TYPES, type)
    ? NOTIFICATION_TYPES[type]
    : undefined;
  if (!entry || entry.emailPolicy === 'never') {
    return false;
  }
  if (entry.emailPolicy === 'required') {
    return true;
  }
  if (entry.emailPreferenceType) {
    return isEmailEnabled(service, userId, entry.emailPreferenceType);
  }
  const { data: preference } = await service.entities.notificationPreference
    .get({ userId, type: entry.id })
    .go();
  return preference
    ? preference.emailEnabled
    : entry.emailPolicy === 'default-on';
};
