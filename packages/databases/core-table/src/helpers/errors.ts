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

// The request names something that can't be done, as opposed to something
// missing: callers map it to a BAD_REQUEST.
export class InvalidRequestError extends Error {
  constructor(message = 'Invalid request') {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

// The write names a value another record already holds (a category name
// another category has): nothing was changed, and callers map it to a
// CONFLICT.
export class NameConflictError extends Error {
  constructor(message = 'That name is already taken') {
    super(message);
    this.name = 'NameConflictError';
  }
}

// A category's slug stayed taken through every retry, because of other
// creates racing on the same slug. Nothing was changed and a retry is safe.
export class SlugUnavailableError extends Error {
  constructor(message = 'No free slug for that name; try again') {
    super(message);
    this.name = 'SlugUnavailableError';
  }
}
