/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { PageContext } from './page.js';
import { renderCoursePage } from './render-course.js';
import { renderProfilePage } from './render-profile.js';

const HOSTILE = '</script><script>alert(1)</script>"\'&';

const context = (allowIndexing: boolean): PageContext => ({
  host: 'learn.example.com',
  siteName: 'Discava',
  allowIndexing,
  mediaUrl: (key) => (key ? `https://media.example.com/${key}` : undefined),
  defaultImageUrl: 'https://learn.example.com/og-default.png',
});

const fullCourse = {
  courseId: 'c1',
  title: 'Intro to Rust',
  description: 'First paragraph.\n\nSecond paragraph.',
  status: 'published' as const,
  imageKey: 'courses/c1/image/x.jpg',
  priceAmount: 1999,
  priceCurrency: 'USD',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  learningOutcomes: ['Write safe code'],
  requirements: ['A laptop'],
  level: 'Beginner',
  language: 'English',
  durationHours: 4,
  category: { slug: 'programming', name: 'Programming' },
  instructors: [
    { handle: 'Ada', displayName: 'Ada Lovelace', headline: 'Pioneer' },
  ],
  modules: [
    {
      moduleId: 'm1',
      courseId: 'c1',
      title: 'Basics',
      order: 1,
      createdAt: '',
      updatedAt: '',
      lessons: [
        {
          lessonId: 'l1',
          moduleId: 'm1',
          courseId: 'c1',
          title: 'Ownership',
          kind: 'lesson' as const,
          order: 1,
          createdAt: '',
          updatedAt: '',
        },
      ],
    },
  ],
};

const reviews = {
  items: [
    {
      reviewerName: 'Sam',
      rating: 5,
      text: 'Great',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  ],
  cursor: null,
};

describe('renderCoursePage', () => {
  it('renders a full course', () => {
    const page = renderCoursePage(context(true), {
      course: fullCourse,
      summary: {
        count: 1,
        average: 5,
        stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      },
      reviews,
    });
    expect(page.head).toContain('<title>Intro to Rust | Discava</title>');
    expect(page.head).toContain(
      '<link rel="canonical" href="https://learn.example.com/learn/c1" />',
    );
    expect(page.head).toContain('property="og:title"');
    expect(page.head).toContain('name="twitter:card"');
    expect(page.head).toContain(
      'content="https://media.example.com/courses/c1/image/x.jpg"',
    );
    expect(page.head).not.toContain('noindex');
    expect(page.head).toContain('"@type":"Course"');
    expect(page.head).toContain('"aggregateRating"');
    expect(page.root).toContain('<h1');
    expect(page.root).toContain('Write safe code');
    expect(page.root).toContain('A laptop');
    expect(page.root).toContain('Ownership');
    expect(page.root).toContain('href="/instructors/ada"');
    expect(page.root).toContain('Sam');
    expect(JSON.parse(page.pageData)).toHaveProperty('course.publicView');
    expect(JSON.parse(page.pageData)).toHaveProperty('review.summary');
    expect(JSON.parse(page.pageData)).toHaveProperty('review.list');
  });

  it('renders a bare course without rating, image or sections', () => {
    const page = renderCoursePage(context(false), {
      course: {
        ...fullCourse,
        description: undefined,
        imageKey: undefined,
        learningOutcomes: [],
        requirements: [],
        level: undefined,
        language: undefined,
        durationHours: undefined,
        category: undefined,
        instructors: [],
        modules: [],
        priceAmount: 0,
      },
      summary: { count: 0, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      reviews: { items: [], cursor: null },
    });
    expect(page.head).toContain('<meta name="robots" content="noindex" />');
    expect(page.head).not.toContain('aggregateRating');
    expect(page.head).toContain('https://learn.example.com/og-default.png');
    expect(page.root).not.toContain("What you'll learn");
    expect(page.root).not.toContain('Requirements');
    expect(page.root).toContain('Free');
  });

  it('escapes a hostile string in every field', () => {
    const page = renderCoursePage(context(true), {
      course: {
        ...fullCourse,
        title: HOSTILE,
        description: HOSTILE,
        learningOutcomes: [HOSTILE],
        requirements: [HOSTILE],
        level: HOSTILE,
        language: HOSTILE,
        category: { slug: 's', name: HOSTILE },
        instructors: [
          { handle: 'ada', displayName: HOSTILE, headline: HOSTILE },
        ],
        modules: [
          {
            ...fullCourse.modules[0]!,
            title: HOSTILE,
            lessons: [
              { ...fullCourse.modules[0]!.lessons[0]!, title: HOSTILE },
            ],
          },
        ],
      },
      summary: {
        count: 1,
        average: 5,
        stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      },
      reviews: {
        items: [{ ...reviews.items[0]!, reviewerName: HOSTILE, text: HOSTILE }],
        cursor: null,
      },
    });
    const all = `${page.head}${page.root}${page.pageData}`;
    expect(all).not.toContain('<script>alert');
    expect(all).not.toContain('alert(1)</script><');
    // The only script tags are our own.
    expect(all.match(/<script/g)).toHaveLength(1);
    expect(all.match(/<\/script>/g)).toHaveLength(1);
    expect(page.pageData).not.toMatch(/[<>&]/);
  });
});

describe('renderProfilePage', () => {
  const profile = {
    handle: 'Ada',
    displayName: 'Ada Lovelace',
    headline: 'Pioneer',
    bio: 'One.\n\nTwo.',
    courses: [{ courseId: 'c1', title: 'Intro to Rust', ratingCount: 0 }],
  };

  it('renders a profile with a lower-case canonical', () => {
    const page = renderProfilePage(context(true), profile);
    expect(page.head).toContain('<title>Ada Lovelace | Discava</title>');
    expect(page.head).toContain(
      'href="https://learn.example.com/instructors/ada"',
    );
    expect(page.head).toContain('"@type":"ProfilePage"');
    expect(page.root).toContain('<h1');
    expect(page.root).toContain('href="/learn/c1"');
    expect(JSON.parse(page.pageData)).toHaveProperty(
      'instructorProfile.publicView',
    );
  });

  it('escapes a hostile string in every field', () => {
    const page = renderProfilePage(context(true), {
      handle: 'ada',
      displayName: HOSTILE,
      headline: HOSTILE,
      bio: HOSTILE,
      courses: [{ courseId: 'c1', title: HOSTILE, ratingCount: 0 }],
    });
    const all = `${page.head}${page.root}${page.pageData}`;
    expect(all.match(/<script/g)).toHaveLength(1);
    expect(all).not.toContain('<script>alert');
  });
});
