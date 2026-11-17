/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { toCourseDocument } from './course-document.js';

describe('toCourseDocument', () => {
  // A course MODIFY that only flips the certificates setting still reaches
  // the indexer, which must then write the same document it already has.
  it('is unchanged by the course’s certificatesEnabled setting', () => {
    const course = {
      courseId: 'course-1',
      title: 'Intro',
      description: 'About',
      publishedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    expect(toCourseDocument({ ...course, certificatesEnabled: false })).toEqual(
      toCourseDocument({ ...course, certificatesEnabled: true }),
    );
  });
});
