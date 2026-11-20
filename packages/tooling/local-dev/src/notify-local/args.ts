/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { NOTIFICATION_TYPES } from '@discava/core-table';

export type NotifyRequest = {
  type: string;
  params: Record<string, string>;
  dedupeKey: string;
  occurredAt: string;
} & ({ userId: string } | { courseId: string });

const USAGE =
  'Usage: notify-local (--user <sub> | --course <courseId>) --type <id> [--param k=v]... [--key <dedupeKey>]';

/** Canned values for a type's params, so a bare `--type` publishes something. */
export const cannedParams = (type: string): Record<string, string> => {
  // Sample params would name a certificate that doesn't exist.
  if (type.startsWith('certificate.')) {
    throw new Error(
      'Certificate notifications belong to a certificate: complete a course instead',
    );
  }
  const entry = Object.hasOwn(NOTIFICATION_TYPES, type)
    ? NOTIFICATION_TYPES[type]
    : undefined;
  if (!entry) {
    throw new Error(
      `Unknown type "${type}"; the types are ${Object.keys(NOTIFICATION_TYPES).join(', ')}`,
    );
  }
  return Object.fromEntries(
    entry.params.map((name) => [
      name,
      name === 'rating' ? '5' : `sample-${name}`,
    ]),
  );
};

/**
 * What to publish, from the command line. Throws a usage message for a
 * missing or contradictory option, so a typo can't publish nothing quietly.
 * The key defaults to a new one per run, `occurredAt` to now.
 */
export const parseNotifyArgs = (
  args: string[],
  now: () => Date = () => new Date(),
  newKey: () => string = randomUUID,
): NotifyRequest => {
  const { values } = parseArgs({
    // `nx run ... -- <args>` may pass the separator through.
    args: args.filter((arg) => arg !== '--'),
    options: {
      user: { type: 'string' },
      course: { type: 'string' },
      type: { type: 'string' },
      param: { type: 'string', multiple: true },
      key: { type: 'string' },
    },
    strict: true,
  });
  if (!values.type || (!values.user && !values.course)) {
    throw new Error(USAGE);
  }
  if (values.user && values.course) {
    throw new Error(`Give --user or --course, not both. ${USAGE}`);
  }
  const params = cannedParams(values.type);
  for (const pair of values.param ?? []) {
    const at = pair.indexOf('=');
    if (at <= 0) {
      throw new Error(`"${pair}" is not k=v. ${USAGE}`);
    }
    params[pair.slice(0, at)] = pair.slice(at + 1);
  }
  const common = {
    type: values.type,
    params,
    dedupeKey: values.key ?? `notify-local-${newKey()}`,
    occurredAt: now().toISOString(),
  };
  return values.user
    ? { ...common, userId: values.user }
    : { ...common, courseId: values.course as string };
};
