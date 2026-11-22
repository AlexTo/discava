/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IInstructorProfilePublicViewOutput } from '../schema/index.js';
import { escapeHtml, jsonForScript } from './html.js';
import {
  buildHead,
  type PageContext,
  paragraphsHtml,
  type RenderedPage,
} from './page.js';

/** An instructor's public profile for crawlers and first paint. */
export const renderProfilePage = (
  context: PageContext,
  profile: IInstructorProfilePublicViewOutput,
): RenderedPage => {
  const handle = profile.handle.toLowerCase();
  const photo = context.mediaUrl(profile.photoKey);
  const description =
    profile.headline ??
    `${profile.displayName} teaches ${profile.courses.length} ${profile.courses.length === 1 ? 'course' : 'courses'} on ${context.brand.name}.`;

  const root = `<main class="mx-auto w-full max-w-6xl px-6 py-10 lg:px-8"><header class="flex flex-col items-start gap-6 sm:flex-row">${
    photo
      ? `<img src="${escapeHtml(photo)}" alt="" class="size-28 rounded-full" />`
      : ''
  }<div class="min-w-0 max-w-2xl"><h1 class="text-balance text-3xl font-bold tracking-tight">${escapeHtml(profile.displayName)}</h1>${
    profile.headline
      ? `<p class="mt-2 text-lg text-muted-foreground">${escapeHtml(profile.headline)}</p>`
      : ''
  }${profile.bio ? paragraphsHtml(profile.bio, 'mt-4 leading-7') : ''}</div></header><section class="mt-10"><h2 class="text-xl font-semibold">Courses</h2><ul class="mt-4 space-y-2">${profile.courses
    .map(
      (course) =>
        `<li><a href="/learn/${encodeURIComponent(course.courseId)}" class="font-medium underline-offset-4 hover:underline">${escapeHtml(course.title)}</a></li>`,
    )
    .join('')}</ul></section></main>`;

  return {
    head: buildHead(context, {
      title: profile.displayName,
      description,
      path: `/instructors/${handle}`,
      type: 'profile',
      image: photo,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        url: `https://${context.host}/instructors/${handle}`,
        mainEntity: {
          '@type': 'Person',
          name: profile.displayName,
          ...(profile.headline && { jobTitle: profile.headline }),
          ...(profile.bio && { description: profile.bio }),
          ...(photo && { image: photo }),
        },
      },
    }),
    root,
    pageData: jsonForScript({ 'instructorProfile.publicView': profile }),
  };
};
