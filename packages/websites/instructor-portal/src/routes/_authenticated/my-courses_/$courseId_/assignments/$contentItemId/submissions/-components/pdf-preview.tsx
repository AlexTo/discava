/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// Never evaluate code a PDF carries.
const OPTIONS = { isEvalSupported: false } as NonNullable<
  React.ComponentProps<typeof Document>['options']
>;

// The page's width until the container has been measured.
const DEFAULT_WIDTH = 560;

// A PDF rendered in the page, one page at a time. Loaded lazily by
// FilePreview so pdf.js stays in a chunk of its own.
export function PdfPreview({
  url,
  onError,
}: {
  url: string;
  onError: () => void;
}) {
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="overflow-auto rounded-lg border bg-muted/30"
      >
        <Document
          file={url}
          options={OPTIONS}
          onLoadSuccess={({ numPages }) => setPages(numPages)}
          onLoadError={onError}
          onSourceError={onError}
          loading={<p className="p-4 text-sm">Loading the preview…</p>}
        >
          {/* The canvas only: the text and annotation layers need react-pdf's
              CSS, and without it print the page's text again below it. */}
          <Page
            pageNumber={page}
            width={Math.min(DEFAULT_WIDTH, containerWidth)}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onRenderError={onError}
          />
        </Document>
      </div>
      {pages > 1 ? (
        <div className="flex items-center gap-3 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous page
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Next page
          </Button>
        </div>
      ) : null}
    </div>
  );
}
