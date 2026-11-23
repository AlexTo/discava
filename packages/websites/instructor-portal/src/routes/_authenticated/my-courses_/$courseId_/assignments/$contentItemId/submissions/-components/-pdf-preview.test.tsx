/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, render } from '@testing-library/react';
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

  it('fits the page to a container narrower than 560px', () => {
    let report: (width: number) => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          report = (width) =>
            act(() =>
              callback(
                [{ contentRect: { width } } as ResizeObserverEntry],
                this as unknown as ResizeObserver,
              ),
            );
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    render(<PdfPreview url="https://files.test/a.pdf" onError={() => {}} />);
    expect(pageProps.at(-1)).toMatchObject({ width: 560 });

    report(300);
    expect(pageProps.at(-1)).toMatchObject({ width: 300 });

    report(900);
    expect(pageProps.at(-1)).toMatchObject({ width: 560 });
    vi.unstubAllGlobals();
  });
});
