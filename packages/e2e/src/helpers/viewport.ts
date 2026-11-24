/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Locator, type Page } from '@playwright/test';

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

// Asserts every match is visible and lies within the viewport's width. A
// failure names the first five that don't, with their accessible names.
export const expectOnScreen = async (locator: Locator) => {
  await expect
    .poll(
      () =>
        locator.evaluateAll((elements) => {
          const off = elements
            .filter((el) => {
              const box = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              const visible =
                box.width > 0 &&
                box.height > 0 &&
                style.visibility !== 'hidden' &&
                style.display !== 'none';
              return !visible || box.x < 0 || box.x + box.width > innerWidth;
            })
            .slice(0, 5)
            .map(
              (el) =>
                el.getAttribute('aria-label') ??
                (el.textContent ?? '').trim().slice(0, 60),
            );
          return off.length === 0
            ? 'on screen'
            : `off screen: ${off.join(' | ')}`;
        }),
      { message: 'a control is off screen' },
    )
    .toBe('on screen');
};

// Asserts a dialog does not scroll sideways inside itself and its right edge
// is within the viewport.
export const expectDialogFits = async (dialog: Locator) => {
  await expect
    .poll(
      () =>
        dialog.evaluate((el) => {
          const box = el.getBoundingClientRect();
          if (el.scrollWidth > el.clientWidth) {
            return `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`;
          }
          return box.right <= innerWidth
            ? 'fits'
            : `right edge ${box.right} > ${innerWidth}`;
        }),
      { message: 'the dialog does not fit the viewport' },
    )
    .toBe('fits');
};

// Asserts a control's target is at least 24×24px (WCAG 2.5.8). The target is
// what a click lands on, so a hit area widened by a pseudo-element counts even
// though the control's own box is smaller: the points 11.5px left, right,
// above and below its centre must each hit the control. A failure gives the
// control's box and what each missed point hit instead.
export const expectTargetAtLeast24 = async (locator: Locator) => {
  await locator.scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        locator.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          const reach = 11.5;
          const points: [string, number, number][] = [
            ['left', x - reach, y],
            ['right', x + reach, y],
            ['above', x, y - reach],
            ['below', x, y + reach],
          ];
          const missed = points.flatMap(([side, px, py]) => {
            const hit = document.elementFromPoint(px, py);
            return hit && el.contains(hit)
              ? []
              : [`${side} hit ${hit?.tagName.toLowerCase() ?? 'nothing'}`];
          });
          return missed.length === 0
            ? 'at least 24px'
            : `${Math.round(box.width)}×${Math.round(box.height)}px, ${missed.join(', ')}`;
        }),
      { message: 'the target is smaller than 24×24px' },
    )
    .toBe('at least 24px');
};
