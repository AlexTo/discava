/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildNotification,
  NOTIFICATION_TYPES,
  NotificationInputError,
} from './notification-types.js';

const sample = (id: string): Record<string, string> =>
  Object.fromEntries(
    NOTIFICATION_TYPES[id].params.map((name) => [name, `<${name}>`]),
  );

const ids = Object.keys(NOTIFICATION_TYPES);

describe('NOTIFICATION_TYPES', () => {
  it('has the v1 types and the discussion types', () => {
    expect(ids.sort()).toEqual([
      'announcement.posted',
      'assignment.returned',
      'certificate.issued',
      'certificate.reminder',
      'discussion.accepted',
      'discussion.answered',
      'discussion.reply',
      'order.refunded',
      'review.received',
    ]);
  });

  it.each(ids)('%s is keyed by its own <area>.<event> id', (id) => {
    expect(NOTIFICATION_TYPES[id].id).toBe(id);
    expect(id).toMatch(/^[a-z]+\.[a-z]+$/);
  });

  it('sets the email policies', () => {
    expect(
      Object.fromEntries(
        ids.map((id) => [id, NOTIFICATION_TYPES[id].emailPolicy]),
      ),
    ).toEqual({
      'assignment.returned': 'default-on',
      'certificate.issued': 'default-on',
      'certificate.reminder': 'default-on',
      'announcement.posted': 'default-on',
      'discussion.reply': 'default-on',
      'discussion.answered': 'default-on',
      'discussion.accepted': 'default-off',
      'order.refunded': 'required',
      'review.received': 'default-off',
    });
  });
});

describe('emailPreferenceType', () => {
  const followers = Object.values(NOTIFICATION_TYPES).filter(
    (type) => type.emailPreferenceType,
  );

  it('is set on the certificate reminder, following certificate.issued', () => {
    expect(NOTIFICATION_TYPES['certificate.reminder'].emailPreferenceType).toBe(
      'certificate.issued',
    );
    expect(followers.map((type) => type.id)).toEqual(['certificate.reminder']);
  });

  it.each(followers.map((type) => type.id))(
    '%s names an existing type that has none itself and the same email policy',
    (id) => {
      const type = NOTIFICATION_TYPES[id];
      const named = Object.hasOwn(
        NOTIFICATION_TYPES,
        type.emailPreferenceType as string,
      )
        ? NOTIFICATION_TYPES[type.emailPreferenceType as string]
        : undefined;
      expect(named).toBeDefined();
      expect(named?.emailPreferenceType).toBeUndefined();
      expect(named?.emailPolicy).toBe(type.emailPolicy);
    },
  );
});

describe('buildNotification', () => {
  it.each(ids)('builds a title, body and link for %s', (id) => {
    const built = buildNotification(id, sample(id));

    expect(built.title.length).toBeGreaterThan(0);
    expect(built.body.length).toBeGreaterThan(0);
    expect(built.link.path.startsWith('/')).toBe(true);
    expect(['student', 'instructor', 'admin']).toContain(built.link.portal);
  });

  it('builds a type without an action as before', () => {
    expect(
      buildNotification('review.received', sample('review.received')),
    ).not.toHaveProperty('action');
  });

  it('builds the certificate notification with its two links', () => {
    expect(
      buildNotification('certificate.issued', {
        certificateId: 'ABCD-EFGH-JKLM-NPQR',
        courseTitle: 'History',
      }),
    ).toEqual({
      title: 'Your certificate for History is ready',
      body: 'You completed History. View your certificate, or add it to your LinkedIn profile so employers can see it.',
      link: { portal: 'student', path: '/certificates/ABCD-EFGH-JKLM-NPQR' },
      action: {
        label: 'Add to LinkedIn profile',
        path: '/certificates/ABCD-EFGH-JKLM-NPQR/linkedin?source=issued-email',
      },
    });
  });

  it('builds the certificate reminder, with the reminder-email source', () => {
    expect(
      buildNotification('certificate.reminder', {
        certificateId: 'ABCD-EFGH-JKLM-NPQR',
        courseTitle: 'History',
      }),
    ).toEqual({
      title: 'Add your History certificate to LinkedIn',
      body: "Your certificate for History isn't on your LinkedIn profile yet, as far as we can tell. Adding it takes one click.",
      link: { portal: 'student', path: '/certificates/ABCD-EFGH-JKLM-NPQR' },
      action: {
        label: 'Add to LinkedIn profile',
        path: '/certificates/ABCD-EFGH-JKLM-NPQR/linkedin?source=reminder-email',
      },
    });
  });

  it('cuts an action label to 60 characters', () => {
    const original = NOTIFICATION_TYPES['review.received'].build;
    NOTIFICATION_TYPES['review.received'].build = (p) => ({
      ...original(p),
      action: { label: 'x'.repeat(100), path: '/a' },
    });
    try {
      const { action } = buildNotification(
        'review.received',
        sample('review.received'),
      );
      expect(action?.label).toHaveLength(60);
      expect(action?.path).toBe('/a');
    } finally {
      NOTIFICATION_TYPES['review.received'].build = original;
    }
  });

  it('links an assignment return to the lesson', () => {
    expect(
      buildNotification('assignment.returned', {
        courseId: 'c1',
        lessonId: 'l1',
        assignmentTitle: 'A',
        courseTitle: 'C',
      }).link,
    ).toEqual({ portal: 'student', path: '/learn/c1/lesson/l1' });
  });

  it('links an announcement to the course home', () => {
    expect(
      buildNotification('announcement.posted', {
        courseId: 'c1',
        courseTitle: 'C',
        announcementTitle: 'A',
        excerpt: 'E',
      }).link,
    ).toEqual({ portal: 'student', path: '/learn/c1/home' });
  });

  it.each(['discussion.reply', 'discussion.answered', 'discussion.accepted'])(
    '%s has complete params, a lesson link and fits long names',
    (id) => {
      const params = {
        courseId: 'c1',
        lessonId: 'l1',
        authorName: 'N'.repeat(300),
        excerpt: 'E'.repeat(140),
      };
      expect(NOTIFICATION_TYPES[id].params.every((n) => n in params)).toBe(
        true,
      );
      const built = buildNotification(id, params);
      expect(built.link).toEqual({
        portal: 'student',
        path: '/learn/c1/lesson/l1',
      });
      expect(built.title.length).toBeLessThanOrEqual(120);
      expect(built.body.length).toBeLessThanOrEqual(500);
    },
  );

  it('tells a student their refund went through and links to the course', () => {
    expect(NOTIFICATION_TYPES['order.refunded'].params).toEqual([
      'courseTitle',
      'courseId',
      'amount',
    ]);
    const built = buildNotification('order.refunded', {
      courseTitle: 'Algebra',
      courseId: 'c1',
      amount: '$49.00',
    });
    expect(built.title).toContain('Algebra');
    expect(built.body).toContain('$49.00');
    expect(built.link).toEqual({ portal: 'student', path: '/learn/c1' });
  });

  it('links a review to the instructor portal', () => {
    expect(
      buildNotification('review.received', {
        courseId: 'c1',
        courseTitle: 'C',
        rating: '5',
      }).link,
    ).toEqual({ portal: 'instructor', path: '/my-courses/c1/reviews' });
  });

  it('throws on an unknown type', () => {
    expect(() => buildNotification('nope.nothing', {})).toThrow(
      NotificationInputError,
    );
  });

  it.each(ids)('throws on a missing param for %s', (id) => {
    for (const name of NOTIFICATION_TYPES[id].params) {
      const { [name]: _, ...rest } = sample(id);
      expect(() => buildNotification(id, rest)).toThrow(NotificationInputError);
    }
  });

  it('throws on an empty param', () => {
    expect(() =>
      buildNotification('assignment.returned', {
        ...sample('assignment.returned'),
        courseId: '',
      }),
    ).toThrow(NotificationInputError);
  });

  it('throws on a non-string param', () => {
    expect(() =>
      buildNotification('review.received', {
        ...sample('review.received'),
        rating: 5 as never,
      }),
    ).toThrow(NotificationInputError);
  });

  it('truncates the title to 120 and the body to 500 characters with an ellipsis', () => {
    const long = 'x'.repeat(1000);
    const built = buildNotification('announcement.posted', {
      courseId: 'c1',
      courseTitle: long,
      announcementTitle: long,
      excerpt: long,
    });

    expect(built.title).toHaveLength(120);
    expect(built.title.endsWith('…')).toBe(true);
    expect(built.body).toHaveLength(500);
    expect(built.body.endsWith('…')).toBe(true);
  });

  it('leaves short text alone', () => {
    const built = buildNotification('discussion.reply', {
      courseId: 'c1',
      lessonId: 'l1',
      authorName: 'Bob',
      excerpt: 'Hello',
    });
    expect(built.title).not.toContain('…');
    expect(built.body).not.toContain('…');
  });

  it.each(ids)('%s ignores a param the type does not declare', (id) => {
    const built = buildNotification(id, {
      ...sample(id),
      surprise: 'SURPRISE',
    });
    expect(JSON.stringify(built)).not.toContain('SURPRISE');
  });
});
