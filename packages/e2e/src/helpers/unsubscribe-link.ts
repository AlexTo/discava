/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHmac } from 'node:crypto';
import { PORTALS } from './portals.js';

// The local stack's unsubscribe secret (common-server-utils' local-dev).
const LOCAL_UNSUBSCRIBE_SECRET = 'local-dev-unsubscribe-secret';

// The link a delivered email would carry for `userId` and `type`, signed as
// common-server-utils' signUnsubscribeToken does (`<user>.<type>.<signature>`,
// base64url). A scenario uses it to reach the unsubscribe page without
// waiting for an email; if the format changed, the page would show its invalid
// state and the scenario would fail.
export const unsubscribePageUrl = (userId: string, type: string): string => {
  const signature = createHmac('sha256', LOCAL_UNSUBSCRIBE_SECRET)
    .update(`${userId}\n${type}`)
    .digest('base64url');
  const token = [
    Buffer.from(userId).toString('base64url'),
    type,
    signature,
  ].join('.');
  return `${PORTALS.student}/unsubscribe?token=${encodeURIComponent(token)}`;
};
