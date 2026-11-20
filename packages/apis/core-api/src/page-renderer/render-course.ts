/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LANGUAGE_LABELS,
  LEVEL_LABELS,
} from '@discava/common-web-utils/catalogue-labels';
import type {
  IPublicReview,
  IPublicViewCourseOutput,
  IReviewSummaryOutput,
} from '../schema/index.js';
import { escapeHtml, jsonForScript } from './html.js';
import {
  buildHead,
  type PageContext,
  paragraphsHtml,
  type RenderedPage,
} from './page.js';

export interface CourseRenderInput {
  course: IPublicViewCourseOutput;
  summary: IReviewSummaryOutput;
  reviews: { items: IPublicReview[]; cursor: string | null };
}

const priceText = (amount: number, currency: string): string =>
  amount === 0
    ? 'Free'
    : new Intl.NumberFormat('en', { style: 'currency', currency }).format(
        amount / 100,
      );

const list = (items: string[], className: string): string =>
  `<ul class="${className}">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('')}</ul>`;

const stars = (rating: number): string => `${rating} out of 5`;

const structuredData = (
  context: PageContext,
  { course, summary }: CourseRenderInput,
  image: string | undefined,
) => ({
  '@context': 'https://schema.org',
  '@type': 'Course',
  name: course.title,
  ...(course.description && { description: course.description }),
  url: `https://${context.host}/learn/${course.courseId}`,
  ...(image && { image }),
  provider: { '@type': 'Organization', name: context.siteName },
  ...(course.instructors.length > 0 && {
    instructor: course.instructors.map((instructor) => ({
      '@type': 'Person',
      name: instructor.displayName,
      url: `https://${context.host}/instructors/${instructor.handle.toLowerCase()}`,
    })),
  }),
  ...(course.language && { inLanguage: course.language }),
  ...(summary.count >= 1 &&
    summary.average !== undefined && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: summary.average,
        ratingCount: summary.count,
        bestRating: 5,
        worstRating: 1,
      },
    }),
});

/** A published course's landing page for crawlers and first paint. */
export const renderCoursePage = (
  context: PageContext,
  input: CourseRenderInput,
): RenderedPage => {
  const { course, summary, reviews } = input;
  const image = context.mediaUrl(course.imageKey);
  const description =
    course.description ??
    course.learningOutcomes[0] ??
    `${course.title}, a course on ${context.siteName}.`;

  const facts: [string, string][] = [
    ['Price', priceText(course.priceAmount, course.priceCurrency)],
    ...(course.level
      ? [
          ['Level', LEVEL_LABELS[course.level] ?? course.level] as [
            string,
            string,
          ],
        ]
      : []),
    ...(course.language
      ? [
          ['Language', LANGUAGE_LABELS[course.language] ?? course.language] as [
            string,
            string,
          ],
        ]
      : []),
    ...(course.durationHours !== undefined
      ? [['Duration', `${course.durationHours} hours`] as [string, string]]
      : []),
    ...(course.category
      ? [['Category', course.category.name] as [string, string]]
      : []),
  ];

  const sections = [
    course.learningOutcomes.length > 0
      ? `<section class="scroll-mt-32"><h2 class="text-xl font-semibold">What you'll learn</h2>${list(
          course.learningOutcomes,
          'mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2',
        )}</section>`
      : '',
    course.description
      ? `<section class="scroll-mt-32"><h2 class="text-xl font-semibold">About this course</h2>${paragraphsHtml(
          course.description,
          'mt-3 max-w-3xl leading-7 text-muted-foreground',
        )}</section>`
      : '',
    course.requirements.length > 0
      ? `<section class="scroll-mt-32"><h2 class="text-xl font-semibold">Requirements</h2>${list(
          course.requirements,
          'mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground',
        )}</section>`
      : '',
    `<section class="scroll-mt-32 space-y-4"><h2 class="text-xl font-semibold">Curriculum</h2><ol class="space-y-3">${course.modules
      .map(
        (module) =>
          `<li><span class="font-semibold">${escapeHtml(module.title)}</span><ol>${module.lessons
            .map(
              (lesson) =>
                `<li class="text-sm">${escapeHtml(lesson.title)}</li>`,
            )
            .join('')}</ol></li>`,
      )
      .join('')}</ol></section>`,
    course.instructors.length > 0
      ? `<section class="scroll-mt-32 space-y-4"><h2 class="text-xl font-semibold">Instructors</h2><div class="grid gap-4 sm:grid-cols-2">${course.instructors
          .map((instructor) => {
            const photo = context.mediaUrl(instructor.photoKey);
            return `<div>${photo ? `<img src="${escapeHtml(photo)}" alt="" class="size-16 rounded-full" />` : ''}<h3 class="font-semibold">${escapeHtml(instructor.displayName)}</h3>${
              instructor.headline
                ? `<p class="mt-1 text-sm text-muted-foreground">${escapeHtml(instructor.headline)}</p>`
                : ''
            }<a href="/instructors/${encodeURIComponent(instructor.handle.toLowerCase())}" class="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">View profile</a></div>`;
          })
          .join('')}</div></section>`
      : '',
    `<section class="scroll-mt-32 space-y-4"><h2 class="text-xl font-semibold">Reviews</h2>${
      summary.count >= 1 && summary.average !== undefined
        ? `<p class="text-sm">${summary.average} out of 5 from ${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}</p>`
        : '<p class="text-sm text-muted-foreground">No ratings yet</p>'
    }<ul class="space-y-4">${reviews.items
      .map(
        (review) =>
          `<li><p class="font-semibold">${escapeHtml(review.reviewerName)}</p><p class="text-sm">${stars(review.rating)}</p>${
            review.text
              ? `<p class="text-sm text-muted-foreground">${escapeHtml(review.text)}</p>`
              : ''
          }${
            review.response
              ? `<div class="ml-4 border-l-2 pl-4 text-sm"><p class="font-medium">Response from ${escapeHtml(review.response.byName)}</p><p class="mt-1 text-muted-foreground">${escapeHtml(review.response.text)}</p></div>`
              : ''
          }</li>`,
      )
      .join('')}</ul></section>`,
  ];

  const root = `<main class="w-full"><section class="border-b bg-muted/40"><div class="mx-auto max-w-5xl px-6 py-10 lg:px-8"><h1 class="text-balance text-3xl font-bold tracking-tight sm:text-4xl">${escapeHtml(course.title)}</h1>${
    image
      ? `<img src="${escapeHtml(image)}" alt="" class="mt-6 rounded-xl shadow-sm" />`
      : ''
  }<dl class="mt-8 grid sm:grid-cols-2">${facts
    .map(
      ([label, value]) =>
        `<div class="px-5 py-4"><dt class="mt-1 text-sm text-muted-foreground">${escapeHtml(label)}</dt><dd class="font-semibold">${escapeHtml(value)}</dd></div>`,
    )
    .join(
      '',
    )}</dl></div></section><div class="mx-auto max-w-5xl space-y-12 px-6 py-10 lg:px-8">${sections.join('')}</div></main>`;

  return {
    head: buildHead(context, {
      title: course.title,
      description,
      path: `/learn/${course.courseId}`,
      type: 'website',
      image,
      structuredData: structuredData(context, input, image),
    }),
    root,
    pageData: jsonForScript({
      'course.publicView': course,
      'review.summary': summary,
      'review.list': reviews,
    }),
  };
};
