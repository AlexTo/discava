/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// DOM matchers such as toBeInTheDocument and toHaveAccessibleName. Testing
// Library unmounts what each test rendered by itself, since `globals` is on.
import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver, which Radix components use to track sizes.
// Layout isn't computed in jsdom anyway, so observing nothing is enough.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

// Radix captures the pointer and scrolls items into view, which jsdom
// doesn't implement.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no matchMedia, which the sidebar uses to tell phones apart.
// Report a desktop-sized window that never changes.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// jsdom has no IntersectionObserver either (the signed-in home's carousel uses
// it); nothing ever scrolls into view in jsdom, so it never reports.
class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver ??=
  IntersectionObserverStub as unknown as typeof IntersectionObserver;
