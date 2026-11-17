/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { isConditionalCheckFailed } from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// A notification's email delivery state machine. Only the delivery step calls
// these; each is a conditional patch on the previous state, so two deliveries
// racing, or a retried one, can't move a notification backwards or send twice:
//
//   pending --claim--> sending --ok--> sent
//      |                  |--permanent error--> failed(reason)
//      |                  |--transient error--> pending (claim released)
//      |                  |--claim older than 5 min--> unknown
//      |--skip--> skipped(reason)
//
// `sent`, `skipped`, `failed` and `unknown` are final. Each returns whether
// it moved the notification: false means the condition on the previous state
// didn't hold, and nothing was written.

export type EmailSkipReason =
  | 'not-configured'
  | 'opted-out'
  | 'no-address'
  | 'never';

export interface NotificationKey {
  userId: string;
  occurredAt: string;
  id: string;
}

type EmailState =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'unknown';

const transition = async (
  service: CoreTable,
  key: NotificationKey,
  from: EmailState,
  email: {
    state: EmailState;
    reason?: string;
    claimedAt?: string;
    sentAt?: string;
    messageId?: string;
  },
): Promise<boolean> => {
  try {
    await service.entities.notification
      .patch(key)
      .set({ email })
      .where((attr, op) => op.eq(attr.email.state, from))
      .go();
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return false;
    }
    throw error;
  }
};

/** pending to skipped. */
export const skipEmail = (
  service: CoreTable,
  key: NotificationKey,
  reason: EmailSkipReason,
) => transition(service, key, 'pending', { state: 'skipped', reason });

/** pending to sending; false when another delivery holds the claim. */
export const claimEmail = (
  service: CoreTable,
  key: NotificationKey,
  claimedAt: string,
) => transition(service, key, 'pending', { state: 'sending', claimedAt });

/** sending to sent. */
export const markEmailSent = (
  service: CoreTable,
  key: NotificationKey,
  messageId: string,
  sentAt: string,
) => transition(service, key, 'sending', { state: 'sent', sentAt, messageId });

/** sending to failed, after a permanent error. */
export const markEmailFailed = (
  service: CoreTable,
  key: NotificationKey,
  reason: string,
) => transition(service, key, 'sending', { state: 'failed', reason });

/** sending to pending, after a transient error, so a retry can claim it. */
export const releaseEmailClaim = (service: CoreTable, key: NotificationKey) =>
  transition(service, key, 'sending', { state: 'pending' });

/** sending to unknown: the claim went stale, so whether it sent is unknown. */
export const markEmailUnknown = (service: CoreTable, key: NotificationKey) =>
  transition(service, key, 'sending', { state: 'unknown' });

/** The notification's email state, or undefined if it doesn't exist. */
export const readEmailState = async (
  service: CoreTable,
  key: NotificationKey,
) => {
  const { data } = await service.entities.notification.get(key).go();
  return data?.email;
};

export const notificationEmailTransitions = {
  skipEmail,
  claimEmail,
  markEmailSent,
  markEmailFailed,
  releaseEmailClaim,
  markEmailUnknown,
  readEmailState,
};
