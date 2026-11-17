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

// A write conditioned on a record's `version` kept losing to concurrent
// writers. Nothing was changed and a retry is safe, so callers map it to a
// CONFLICT rather than a server error.
export class VersionConflictError extends Error {
  constructor(message = 'Another request changed the same records') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

// The record a caller named doesn't exist for them. The message is the same
// whether it is missing or belongs to someone else, so it doesn't say which.
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}
