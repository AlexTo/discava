/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A DynamoDB conditional write whose condition didn't hold, as opposed to
// any other failure. ElectroDB wraps the SDK's error, so the
// ConditionalCheckFailedException is its cause.
export const isConditionalCheckFailed = (error: unknown): boolean =>
  error instanceof Error &&
  'cause' in error &&
  error.cause instanceof Error &&
  error.cause.name === 'ConditionalCheckFailedException';
