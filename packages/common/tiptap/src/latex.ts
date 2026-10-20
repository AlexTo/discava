/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import katex from 'katex';

export type RenderedLatex = { html: string } | { error: string };

// LaTeX rendered with KaTeX the way the Mathematics extension renders it, or
// KaTeX's explanation of why it can't be, for previewing a formula as it's
// typed. `display` renders it as a block (blockMath) rather than inline.
export const renderLatex = (
  latex: string,
  { display = false }: { display?: boolean } = {},
): RenderedLatex => {
  try {
    return {
      html: katex.renderToString(latex, {
        displayMode: display,
        throwOnError: true,
      }),
    };
  } catch (error) {
    return {
      error:
        error instanceof katex.ParseError
          ? error.rawMessage
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
};
