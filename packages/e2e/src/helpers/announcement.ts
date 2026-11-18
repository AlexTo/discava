/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import { createCoreTableService } from '@discava/core-table';
import type { ApiUser } from './api.js';

// Steps for announcements (#282), for the scenario and the concurrency test.

// A UUID v7 for now, as the instructor portal mints for a new announcement.
export const uuidV7 = () => {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// A Tiptap document with one plain paragraph.
export const announcementBody = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

// Marks the student's enrolment dropped, as the table keeps it (no API drops
// one yet).
export const dropEnrolment = async (courseId: string, student: ApiUser) => {
  const coreTable = await createCoreTableService();
  await coreTable.entities.enrolment
    .patch({ courseId, userId: student.sub })
    .set({ status: 'dropped' })
    .go();
};

// The announcements the student's notifications are about, by their
// `announcement.posted` type and title.
export const announcementNotifications = async (
  student: ApiUser,
  title: string,
) => {
  const { items } = await student.core.notification.list.query({ limit: 50 });
  return items.filter(
    (item) => item.type === 'announcement.posted' && item.title.includes(title),
  );
};
