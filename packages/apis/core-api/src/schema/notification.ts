/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// contracts/core-api-notification: none of these carries a user id, and none
// of the outputs carries `readAt` or the email state.

export const NotificationItemSchema = z.object({
  // The notification's sort key: opaque to clients, its id, and what
  // markRead and markAllRead take.
  position: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.object({
    portal: z.enum(['student', 'instructor', 'admin']),
    path: z.string().startsWith('/'),
  }),
  occurredAt: z.string(),
  read: z.boolean(),
});

export type INotificationItem = z.output<typeof NotificationItemSchema>;

export const NotificationListInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().optional(),
});

export const NotificationListOutputSchema = z.object({
  items: z.array(NotificationItemSchema),
  nextCursor: z.string().optional(),
  unreadCount: z.number(),
});

export const NotificationUnreadCountOutputSchema = z.object({
  unreadCount: z.number(),
});

export const NotificationMarkReadInputSchema = z.object({
  position: z.string(),
});

export const NotificationMarkAllReadInputSchema = z.object({
  through: z.string(),
});

export const NotificationMarkAllReadOutputSchema = z.object({
  unreadCount: z.number(),
  more: z.boolean(),
});

export const NotificationPreferenceSchema = z.object({
  type: z.string(),
  name: z.string(),
  description: z.string(),
  emailEnabled: z.boolean(),
  required: z.boolean(),
});

export type INotificationPreference = z.output<
  typeof NotificationPreferenceSchema
>;

export const NotificationPreferencesOutputSchema = z.array(
  NotificationPreferenceSchema,
);

export const NotificationSetPreferenceInputSchema = z.object({
  type: z.string(),
  emailEnabled: z.boolean(),
});
