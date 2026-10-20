/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Extensions } from '@tiptap/core';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';

export interface ContentExtensionsOptions {
  // Called when a formula is clicked, e.g. to open an editor for it. The
  // editor passes it; read-only renderers and the server don't.
  onMathClick?: (node: ProseMirrorNode, pos: number) => void;
}

// The one set of Tiptap extensions behind every rich text document: lesson
// text, quiz prompts and explanations. The instructor portal's editor, the
// student portal's renderer and instructor-api's validation all build on it,
// so what can be written is exactly what can be stored and shown.
//
// The Mathematics extension's two nodes hold LaTeX, rendered with KaTeX:
// `inlineMath` inside text and `blockMath` on its own line, each with a
// `latex` attribute. Invalid LaTeX is shown as its source, not thrown. They're
// configured one by one rather than through Mathematics, whose single
// katexOptions would render block formulas in KaTeX's inline style.
export const createContentExtensions = ({
  onMathClick,
}: ContentExtensionsOptions = {}): Extensions => [
  StarterKit,
  BlockMath.configure({
    katexOptions: { displayMode: true },
    ...(onMathClick && { onClick: onMathClick }),
  }),
  InlineMath.configure({ ...(onMathClick && { onClick: onMathClick }) }),
];
