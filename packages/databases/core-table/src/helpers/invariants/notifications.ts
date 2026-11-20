/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
} from '../announcement.js';
import { parseNotificationPosition } from '../notification.js';
import { NOTIFICATION_TYPES } from '../notification-types.js';
import { uuidV7Time } from '../uuid-v7.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// Notifications are written only by the helpers in notification.ts,
// notification-read.ts and notification-email.ts; these rules catch a writer
// that went around them. The hour-long limits give delivery's retries and the
// stream router's failure queue time to finish before anything is reported.
const STUCK_AFTER_MS = 60 * 60 * 1000;

const olderThanAnHour = (iso: string | undefined) =>
  iso === undefined || Date.parse(iso) < Date.now() - STUCK_AFTER_MS;

const notificationKey = (n: TableSnapshot['notifications'][number]) => ({
  userId: n.userId,
  occurredAt: n.occurredAt,
  id: n.id,
});

// A user's unreadCount is the number of their notifications that are
// neither marked read nor at or before readThrough.
export const checkNotificationUnreadCountMatches = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.notificationStates.flatMap((state) => {
    const unread = snapshot.notifications.filter(
      (n) =>
        n.userId === state.userId &&
        n.readAt === undefined &&
        (state.readThrough === undefined ||
          `${n.occurredAt}#${n.id}` > state.readThrough),
    ).length;
    return state.unreadCount === unread
      ? []
      : [
          violation(
            'notification-unread-count-matches',
            { userId: state.userId },
            `unreadCount is ${state.unreadCount}, but ${unread} notifications are unread`,
          ),
        ];
  });

// A notification has the shape its writers give it: a registered type,
// a key made of a valid time and id, a link inside the portal, and an email
// state that carries what its state requires and isn't stuck.
export const checkNotificationShape = (snapshot: TableSnapshot): Violation[] =>
  snapshot.notifications.flatMap((n) => {
    const problems: string[] = [];
    if (!Object.hasOwn(NOTIFICATION_TYPES, n.type)) {
      problems.push(`type ${n.type} is not registered`);
    }
    if (!parseNotificationPosition(`${n.occurredAt}#${n.id}`)) {
      problems.push(
        `sort key ${n.occurredAt}#${n.id} is not <occurredAt>#<id> of a millisecond ISO time and 16 hex characters`,
      );
    }
    if (!n.link?.path?.startsWith('/')) {
      problems.push('link.path does not start with /');
    }
    if (
      n.action !== undefined &&
      !(n.action.label && n.action.path?.startsWith('/'))
    ) {
      problems.push('action needs a label and a path starting with /');
    }
    const { email } = n;
    if (email.state === 'sent' && !(email.sentAt && email.messageId)) {
      problems.push('email is sent without sentAt and messageId');
    }
    if (
      (email.state === 'skipped' || email.state === 'failed') &&
      !email.reason
    ) {
      problems.push(`email is ${email.state} without a reason`);
    }
    if (email.state === 'sending' && olderThanAnHour(email.claimedAt)) {
      problems.push('email has been sending for over an hour');
    }
    if (email.state === 'pending' && olderThanAnHour(n.createdAt)) {
      problems.push('email is still pending an hour after the notification');
    }
    return problems.map((message) =>
      violation('notification-shape', notificationKey(n), message),
    );
  });

// A user with notifications has a state, with a count that isn't
// negative and a readThrough that is a valid position.
export const checkNotificationStateExists = (
  snapshot: TableSnapshot,
): Violation[] => {
  const states = new Set(snapshot.notificationStates.map((s) => s.userId));
  const missing = [
    ...new Set(
      snapshot.notifications
        .map((n) => n.userId)
        .filter((userId) => !states.has(userId)),
    ),
  ].map((userId) =>
    violation(
      'notification-state-exists',
      { userId },
      'user has notifications but no notificationState',
    ),
  );
  const bad = snapshot.notificationStates.flatMap((state) => {
    const problems: string[] = [];
    if (!Number.isInteger(state.unreadCount) || state.unreadCount < 0) {
      problems.push(`unreadCount ${state.unreadCount} is not a count`);
    }
    if (
      state.readThrough !== undefined &&
      !parseNotificationPosition(state.readThrough)
    ) {
      problems.push(`readThrough ${state.readThrough} is not a position`);
    }
    return problems.map((message) =>
      violation('notification-state-exists', { userId: state.userId }, message),
    );
  });
  return [...missing, ...bad];
};

// A stored preference is for a registered type whose email can be
// changed: a `required` type is always sent, and a type with
// `emailPreferenceType` follows another type's setting.
export const checkNotificationPreferenceShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.notificationPreferences.flatMap((preference) => {
    const { userId, type } = preference;
    const entry = Object.hasOwn(NOTIFICATION_TYPES, type)
      ? NOTIFICATION_TYPES[type]
      : undefined;
    const problem = !entry
      ? `type ${type} is not registered`
      : entry.emailPolicy === 'required'
        ? `type ${type} is required, so its email can't be changed`
        : entry.emailPreferenceType
          ? `type ${type} follows ${entry.emailPreferenceType}, so it has no setting of its own`
          : undefined;
    return problem
      ? [violation('notification-preference-shape', { userId, type }, problem)]
      : [];
  });

// A finished broadcast says when; one still pending after an hour is a
// fan-out that stopped.
export const checkNotificationBroadcastDoneComplete = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.notificationBroadcasts.flatMap((broadcast) => {
    const record = { id: broadcast.id };
    if (broadcast.status === 'done' && !broadcast.completedAt) {
      return [
        violation(
          'notification-broadcast-done-complete',
          record,
          'broadcast is done without completedAt',
        ),
      ];
    }
    if (
      broadcast.status === 'pending' &&
      olderThanAnHour(broadcast.createdAt)
    ) {
      return [
        violation(
          'notification-broadcast-done-complete',
          record,
          'broadcast has been pending for over an hour',
        ),
      ];
    }
    return [];
  });

// An announcement is well formed: its course exists, its id is a UUID v7
// whose time is its createdAt, its title and body fit, it has an author, and
// it has been edited (version above 1, editedAt not before createdAt) exactly
// when it says so. The body's full schema is checked by the API on write; the
// invariants import no editor code, so only its outline is checked here.
export const checkAnnouncementShape = (
  snapshot: TableSnapshot,
): Violation[] => {
  const courseIds = new Set(snapshot.courses.map((c) => c.courseId));
  return snapshot.announcements.flatMap((a) => {
    const problems: string[] = [];
    if (!courseIds.has(a.courseId)) {
      problems.push('its course does not exist');
    }
    if (uuidV7Time(a.announcementId) !== a.createdAt) {
      problems.push('announcementId is not a UUID v7 made at createdAt');
    }
    const title = a.title.trim();
    if (
      title.length < 1 ||
      title.length > ANNOUNCEMENT_TITLE_MAX ||
      title !== a.title
    ) {
      problems.push(`title is not 1 to ${ANNOUNCEMENT_TITLE_MAX} characters`);
    }
    if (!isDocumentText(a.body)) {
      problems.push(
        `body is not a document of at most ${ANNOUNCEMENT_BODY_MAX} characters`,
      );
    }
    if (!a.authorId) {
      problems.push('authorId is not set');
    }
    if (!(a.version >= 1)) {
      problems.push(`version is ${a.version}, not at least 1`);
    }
    if ((a.editedAt !== undefined) !== a.version > 1) {
      problems.push(
        a.editedAt === undefined
          ? 'version is above 1 without editedAt'
          : 'editedAt is set at version 1',
      );
    } else if (a.editedAt !== undefined && a.editedAt < a.createdAt) {
      problems.push('editedAt is before createdAt');
    }
    return problems.map((problem) =>
      violation(
        'announcement-shape',
        { courseId: a.courseId, announcementId: a.announcementId },
        problem,
      ),
    );
  });
};

const isDocumentText = (body: string) => {
  if (body.length < 1 || body.length > ANNOUNCEMENT_BODY_MAX) {
    return false;
  }
  try {
    return JSON.parse(body)?.type === 'doc';
  } catch {
    return false;
  }
};

// Every announcement has the broadcast that notified its course's
// students, with its id as the dedupe key and its createdAt as the time. One
// direction only: deleting an announcement leaves its broadcast.
export const checkAnnouncementHasBroadcast = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.announcements.flatMap((a) => {
    const broadcasts = snapshot.notificationBroadcasts.filter(
      (b) =>
        b.type === 'announcement.posted' &&
        b.courseId === a.courseId &&
        b.dedupeKey === a.announcementId,
    );
    const problem =
      broadcasts.length === 0
        ? 'no announcement.posted broadcast for it'
        : broadcasts.every((b) => b.occurredAt !== a.createdAt)
          ? 'its broadcast has an occurredAt other than createdAt'
          : undefined;
    return problem
      ? [
          violation(
            'announcement-has-broadcast',
            { courseId: a.courseId, announcementId: a.announcementId },
            problem,
          ),
        ]
      : [];
  });

export const NOTIFICATIONS_CHECKS = [
  {
    name: 'notification-unread-count-matches',
    check: checkNotificationUnreadCountMatches,
  },
  { name: 'notification-shape', check: checkNotificationShape },
  { name: 'notification-state-exists', check: checkNotificationStateExists },
  {
    name: 'notification-preference-shape',
    check: checkNotificationPreferenceShape,
  },
  {
    name: 'notification-broadcast-done-complete',
    check: checkNotificationBroadcastDoneComplete,
  },
  { name: 'announcement-shape', check: checkAnnouncementShape },
  { name: 'announcement-has-broadcast', check: checkAnnouncementHasBroadcast },
] as const satisfies readonly Check[];
