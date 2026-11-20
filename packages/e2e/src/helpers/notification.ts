/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  createCoreTableService,
  notifyCourseStudents,
  publishNotification,
} from '@discava/core-table';
import { expect } from '@playwright/test';
import { SERVICES } from './portals.js';

// Steps for notifications (#279), for the scenario and the concurrency test.

// The sub the local OIDC page gives a user made through its "Someone else"
// form (its `subFor`), so a scenario can publish to a user it signed in
// through the browser.
export const localSubFor = (username: string): string => {
  const hex = createHash('sha256')
    .update(`discava-local:${username}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

export interface Published {
  /** The notification's title, which names `label`. */
  title: string;
  /** What `publishNotification` answered. */
  outcome: 'created' | 'duplicate';
}

// The announcement notification's params for a uniquely named `label`: its
// title is `<course title>: <announcement title>`.
const announcementParams = (label: string) => ({
  courseId: 'e2e-course',
  courseTitle: label,
  announcementTitle: 'Hello',
  excerpt: `Excerpt for ${label}`,
});

export const announcementTitle = (label: string) => `${label}: Hello`;

// Publishes an `announcement.posted` notification to `userId` through the
// table helper, as a producer would. Without `dedupeKey` it is a new event.
export const publishAnnouncement = async (
  userId: string,
  label: string,
  options: { dedupeKey?: string; occurredAt?: string } = {},
): Promise<Published> => {
  const outcome = await publishNotification(await createCoreTableService(), {
    type: 'announcement.posted',
    userId,
    params: announcementParams(label),
    dedupeKey: options.dedupeKey ?? randomUUID(),
    occurredAt: options.occurredAt ?? new Date().toISOString(),
  });
  return { title: announcementTitle(label), outcome };
};

// Asks for every student enrolled in the course to be notified, once per key.
export const publishToCourseStudents = async (
  courseId: string,
  label: string,
  dedupeKey: string,
  occurredAt = new Date().toISOString(),
) => {
  const coreTable = await createCoreTableService();
  return coreTable.transaction
    .write(() =>
      notifyCourseStudents(coreTable, {
        type: 'announcement.posted',
        courseId,
        params: { ...announcementParams(label), courseId },
        dedupeKey,
        occurredAt,
      }),
    )
    .go();
};

export interface InboxEmail {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

// The emails in the local inbox (the event runner's `GET /emails`), newest
// first.
export const inboxEmails = async (): Promise<InboxEmail[]> => {
  const response = await fetch(`${SERVICES.eventRunner}emails`);
  expect(response.ok, `GET /emails: ${response.status}`).toBe(true);
  return (await response.json()) as InboxEmail[];
};

// The emails sent to `address` whose subject names `title`.
export const emailsFor = async (address: string, title: string) =>
  (await inboxEmails()).filter(
    (email) => email.to === address && email.subject.includes(title),
  );

// The "Stop these emails" link in an email's text part.
export const unsubscribeLinkIn = (email: InboxEmail): string => {
  const link = email.text.match(/Stop these emails: (\S+)/)?.[1];
  if (!link) {
    throw new Error('The email has no unsubscribe link');
  }
  return link;
};

// Fires the certificate reminder for a student's certificate now, as its
// schedule does three days after the certificate is issued. The local event
// runner would wait an hour (a reminder must not land in an unrelated test),
// so a scenario asks for no wait. The runner answers once it has queued the
// run, not once the run is done.
export const fireCertificateReminder = async (
  userId: string,
  courseId: string,
) => {
  const response = await fetch(
    `${SERVICES.eventRunner}schedules/certificate-reminder`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { userId, courseId }, delaySeconds: 0 }),
    },
  );
  expect(
    response.status,
    `POST /schedules/certificate-reminder: ${response.status}`,
  ).toBe(202);
};

// The course of a user's one certificate, once it has been issued.
export const certificateCourseIdOf = async (
  userId: string,
): Promise<string> => {
  const coreTable = await createCoreTableService();
  let courseId = '';
  await expect
    .poll(
      async () => {
        const { data } = await coreTable.entities.certificate.query
          .primary({ userId })
          .go();
        courseId = data[0]?.courseId ?? '';
        return courseId;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  return courseId;
};
