/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// DOM matchers such as toBeInTheDocument and toHaveAccessibleName. Testing
// Library unmounts what each test rendered by itself, since `globals` is on.
import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver, which dnd-kit uses to track element sizes.
// Layout isn't computed in jsdom anyway, so observing nothing is enough.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

// Radix Select captures the pointer and scrolls the chosen item into view,
// which jsdom doesn't implement.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// ProseMirror (the rich text editor's engine) measures the caret's screen
// position to scroll it into view and to map clicks to a document position,
// which needs layout that jsdom doesn't compute.
document.elementFromPoint ??= () => null;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
