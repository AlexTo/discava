/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Re-exported so this package's declarations import the extensions, which is
// what adds their commands (toggleBold, insertInlineMath…) to Tiptap's types
// in projects that build an editor from createContentExtensions.
export type { MathematicsOptions } from '@tiptap/extension-mathematics';
export type { StarterKitOptions } from '@tiptap/starter-kit';
export { isValidTiptapDocument, parseTiptapDocument } from './document.js';
export {
  type ContentExtensionsOptions,
  createContentExtensions,
} from './extensions.js';
export { type RenderedLatex, renderLatex } from './latex.js';
