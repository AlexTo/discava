/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'astro/config';

import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';
import astroD2 from 'astro-d2';

// Where the site is published. CI sets both from the repository it runs in
// (see the Build step in .github/workflows/ci.yml), so a fork's docs build for
// its own GitHub Pages address. Unset, the site builds for the root of
// whatever serves it, as `astro dev` does.
const site = process.env.DOCS_SITE || undefined;
const basePath = (process.env.DOCS_BASE_PATH || '').replace(/\/+$/, '');

// https://astro.build/config
export default defineConfig({
  site,
  base: basePath || '/',
  outDir: './dist',
  // Redirect the root URL to the default locale so visitors land on localised content.
  redirects: {
    '/': `${basePath}/en`,
  },
  integrations: [
    starlight({
      title: 'Discava',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/AlexTo/discava',
        },
      ],
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 3,
      },
      defaultLocale: 'en',
      locales: {
        en: {
          label: 'English',
        },
        jp: {
          label: '日本語',
        },
        ko: {
          label: '한국어',
        },
        es: {
          label: 'Español',
        },
        pt: {
          label: 'Português',
        },
        fr: {
          label: 'Français',
        },
        it: {
          label: 'Italiano',
        },
        zh: {
          label: '中文',
        },
        vi: {
          label: 'Tiếng Việt',
        },
      },
      sidebar: [
        {
          label: 'Start here',
          items: ['guides/getting-started'],
        },
        {
          label: 'Deploy',
          items: [{ autogenerate: { directory: 'deploy' } }],
        },
        {
          label: 'Architecture',
          items: [{ autogenerate: { directory: 'architecture' } }],
        },
        {
          label: 'Feature guides',
          items: [
            'guides/instructor-guide',
            'guides/admin-guide',
            'guides/finding-and-taking-courses',
            'guides/building-a-course',
            'guides/video-lessons',
            'guides/quizzes-and-assignments',
            'guides/certificates',
            'guides/lesson-discussions',
            'guides/reviews',
            'guides/announcements',
            'guides/notifications',
            'guides/course-analytics',
            'guides/payments',
            'guides/earnings-and-payouts',
            'guides/branding',
          ],
        },
        {
          label: 'Design',
          items: [{ autogenerate: { directory: 'design' } }],
        },
      ],
      customCss: ['./src/styles/custom.css'],
      plugins: [
        starlightBlog({
          authors: {
            default: {
              name: 'Docs Author',
              title: 'Maintainer',
            },
          },
        }),
      ],
    }),
    // Renders ```d2 code blocks to static SVG at build time. useD2js runs D2
    // as WASM, so neither local builds nor CI need a d2 binary installed.
    astroD2({
      sketch: true,
      experimental: {
        useD2js: true,
      },
    }),
  ],
});
