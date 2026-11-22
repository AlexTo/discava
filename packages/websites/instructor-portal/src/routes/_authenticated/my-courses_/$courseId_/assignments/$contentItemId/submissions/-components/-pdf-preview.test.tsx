/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const pageProps: Record<string, unknown>[] = [];
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Page: (props: Record<string, unknown>) => {
    pageProps.push(props);
    return <canvas />;
  },
}));

const { PdfPreview } = await import('./pdf-preview');

describe('PdfPreview', () => {
  it('draws the page only, without the text and annotation layers', () => {
    render(<PdfPreview url="https://files.test/a.pdf" onError={() => {}} />);

    expect(pageProps.at(-1)).toMatchObject({
      renderTextLayer: false,
      renderAnnotationLayer: false,
    });
  });
});
