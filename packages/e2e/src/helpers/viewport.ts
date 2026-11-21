/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';

// A small phone, the width the portals must fit without scrolling sideways.
export const PHONE = { width: 375, height: 812 };

// Asserts the page is no wider than the viewport. A failure names the widest
// elements (the first five reaching past the right edge) to find the culprit.
export const expectNoSidewaysScroll = async (page: Page) => {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.documentElement;
          if (root.scrollWidth <= root.clientWidth) {
            return 'fits';
          }
          const wide = [...document.body.querySelectorAll('*')]
            .filter((el) => el.getBoundingClientRect().right > innerWidth)
            .slice(0, 5)
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).slice(0, 60)}`,
            );
          return `scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}; wide: ${wide.join(' | ')}`;
        }),
      { message: 'the page scrolls sideways' },
    )
    .toBe('fits');
};
