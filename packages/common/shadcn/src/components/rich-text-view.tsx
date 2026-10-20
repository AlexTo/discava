/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createContentExtensions,
  parseTiptapDocument,
  renderLatex,
} from '@discava/common-tiptap';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import { cn } from 'cn';
import 'katex/dist/katex.min.css';
import { type ReactNode, useMemo } from 'react';

// The same extensions the editor writes with and instructor-api validates
// against, so anything that can be stored can be shown.
const extensions = createContentExtensions();

// A formula, marked up like the editor's (see the maths styles in
// globals.css). KaTeX's output is its own escaped markup; LaTeX it can't
// parse is shown as its source, as the editor does.
function Formula({ node }: { node: ProseMirrorNode }) {
  const display = node.type.name === 'blockMath';
  const Element = display ? 'div' : 'span';
  const latex: string = node.attrs.latex ?? '';
  const rendered = renderLatex(latex, { display });
  const props = {
    'data-type': display ? 'block-math' : 'inline-math',
    'data-latex': latex,
  };
  return 'html' in rendered ? (
    <Element
      {...props}
      className="tiptap-mathematics-render"
      // KaTeX's output, with `trust` off: no links or raw HTML.
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  ) : (
    <Element
      {...props}
      className={cn(
        'tiptap-mathematics-render',
        display ? 'block-math-error' : 'inline-math-error',
      )}
    >
      {latex}
    </Element>
  );
}

const render = (value: string | undefined): ReactNode => {
  const content = parseTiptapDocument(value);
  if (!content) {
    return null;
  }
  try {
    return renderToReactElement({
      content,
      extensions,
      options: {
        nodeMapping: { blockMath: Formula, inlineMath: Formula },
      },
    });
  } catch {
    // Not a document the content schema allows. instructor-api only stores
    // ones it does, so show nothing rather than fail the page.
    return null;
  }
};

/**
 * Shows a rich text document (a text item's body, a quiz prompt or an
 * explanation) read-only: Tiptap's JSON, stringified, as the editor saves it.
 * Rendered straight to elements, without an editor, styled like the editor's
 * content. A missing or unreadable document renders as empty.
 */
export function RichTextView({
  value,
  className,
}: {
  value: string | undefined;
  className?: string;
}) {
  const content = useMemo(() => render(value), [value]);
  return (
    <div
      data-slot="rich-text-view"
      className={cn('prose prose-sm dark:prose-invert max-w-none', className)}
    >
      {content}
    </div>
  );
}
