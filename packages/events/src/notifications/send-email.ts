/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { signUnsubscribeToken } from '@discava/common-server-utils/unsubscribe-token';
import {
  claimEmail,
  type createCoreTableService,
  type EmailSkipReason,
  governingEmailType,
  isEmailEnabled,
  markEmailFailed,
  markEmailSent,
  markEmailUnknown,
  NOTIFICATION_TYPES,
  type NotificationKey,
  type NotificationPortal,
  readEmailState,
  releaseEmailClaim,
  skipEmail,
} from '@discava/core-table';
import { type EmailMessage, EmailPermanentError, sendEmail } from './email.js';
import { renderNotificationEmail } from './email-template.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

/** A claim older than this is taken to be from an invocation that died. */
export const CLAIM_LEASE_MS = 5 * 60_000;

export interface EmailConfig {
  /** Unset: the stage has no sender, and email is recorded as not-configured. */
  fromAddress?: string;
  portalUrls: Record<NotificationPortal, string>;
  coreApiUrl: string;
  unsubscribeSecret: () => Promise<string>;
}

export type EmailOutcome =
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'unknown'
  | 'already-handled';

/**
 * A claim is held by a delivery that may still be running: throwing makes the
 * queue deliver the record again after its visibility timeout.
 */
export class EmailClaimHeldError extends Error {
  override name = 'EmailClaimHeldError';
}

/** The send failed in a way that may pass: the claim is released for a retry. */
export class EmailTransientRetryError extends Error {
  override name = 'EmailTransientRetryError';
}

/**
 * Sends the email for one notification, at most once. Every step is a
 * conditional patch on the previous `email.state` (core-table's
 * helpers/notification-email.ts), so a repeated or late delivery of the same
 * record can't move a final state or send a second email.
 */
export const sendNotificationEmail = async (
  coreTable: CoreTable,
  key: NotificationKey,
  config: EmailConfig,
  send: (message: EmailMessage) => Promise<{ messageId: string }> = sendEmail,
  now: () => number = Date.now,
): Promise<EmailOutcome> => {
  const { data: notification } = await coreTable.entities.notification
    .get(key)
    .go();
  const state = notification?.email.state;
  if (!notification || (state !== 'pending' && state !== 'sending')) {
    return 'already-handled';
  }

  // A repeat of a delivery that already claimed it: see handleLostClaim.
  if (state === 'sending') {
    return handleLostClaim(coreTable, key, now);
  }

  const checked = await checkRecipient(coreTable, notification, config);
  if ('skip' in checked) {
    await skipEmail(coreTable, key, checked.skip);
    return 'skipped';
  }

  // A type that follows another's setting is unsubscribed, and labelled, as
  // that type.
  const entry = governingEmailType(NOTIFICATION_TYPES[notification.type]);
  const token = signUnsubscribeToken(
    await config.unsubscribeSecret(),
    key.userId,
    entry.id,
  );
  const trim = (url: string) => url.replace(/\/+$/, '');
  const message: EmailMessage = {
    to: checked.to,
    from: config.fromAddress as string,
    ...renderNotificationEmail({
      title: notification.title,
      body: notification.body,
      link: notification.link,
      action: notification.action,
      portalUrl: config.portalUrls[notification.link.portal],
      unsubscribeUrl: `${trim(config.coreApiUrl)}/unsubscribe/${token}`,
      unsubscribePageUrl: `${trim(config.portalUrls.student)}/unsubscribe?token=${encodeURIComponent(token)}`,
      settingsUrl: `${trim(config.portalUrls.student)}/settings/notifications`,
      typeName: entry.name,
    }),
  };

  if (!(await claimEmail(coreTable, key, new Date(now()).toISOString()))) {
    return handleLostClaim(coreTable, key, now);
  }

  let result: { messageId: string };
  try {
    result = await send(message);
  } catch (error) {
    if (error instanceof EmailPermanentError) {
      await markEmailFailed(coreTable, key, error.message);
      return 'failed';
    }
    await releaseEmailClaim(coreTable, key);
    throw new EmailTransientRetryError((error as Error).message, {
      cause: error,
    });
  }
  await markEmailSent(
    coreTable,
    key,
    result.messageId,
    new Date(now()).toISOString(),
  );
  return 'sent';
};

const checkRecipient = async (
  coreTable: CoreTable,
  notification: { userId: string; type: string },
  config: EmailConfig,
): Promise<{ skip: EmailSkipReason } | { to: string }> => {
  const entry = Object.hasOwn(NOTIFICATION_TYPES, notification.type)
    ? NOTIFICATION_TYPES[notification.type]
    : undefined;
  if (!entry || entry.emailPolicy === 'never') {
    return { skip: 'never' };
  }
  if (!config.fromAddress) {
    return { skip: 'not-configured' };
  }
  const { data: user } = await coreTable.entities.user
    .get({ userId: notification.userId })
    .go();
  if (!user?.email) {
    return { skip: 'no-address' };
  }
  if (
    !(await isEmailEnabled(coreTable, notification.userId, notification.type))
  ) {
    return { skip: 'opted-out' };
  }
  return { to: user.email };
};

// Another delivery got there first. A final state is left alone; a fresh
// claim may still be sending, so this delivery tries again later; a stale one
// is from an invocation that died after maybe sending, and is recorded as
// unknown rather than risk a second email.
const handleLostClaim = async (
  coreTable: CoreTable,
  key: NotificationKey,
  now: () => number,
): Promise<EmailOutcome> => {
  const email = await readEmailState(coreTable, key);
  if (!email || email.state === 'sent') {
    return 'already-handled';
  }
  if (email.state === 'sending' || email.state === 'pending') {
    const claimedAt = email.claimedAt ? Date.parse(email.claimedAt) : 0;
    if (email.state === 'pending' || now() - claimedAt < CLAIM_LEASE_MS) {
      throw new EmailClaimHeldError(
        'The email is being sent by another delivery',
      );
    }
    await markEmailUnknown(coreTable, key);
    return 'unknown';
  }
  return 'already-handled';
};
