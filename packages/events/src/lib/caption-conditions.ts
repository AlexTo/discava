/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The patch conditions below only fire while the item still plays the version
// the job was for and is still waiting for its captions.
export const stillPending =
  (nonce: string) =>
  (
    attr: { status: unknown; s3Key: unknown; captionsStatus: unknown },
    op: {
      eq(attribute: unknown, value: unknown): string;
      contains(attribute: unknown, value: unknown): string;
    },
  ): string =>
    [
      op.eq(attr.status, 'ready'),
      op.contains(attr.s3Key, `/${nonce}/`),
      op.eq(attr.captionsStatus, 'pending'),
    ].join(' AND ');
