/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// Never evaluate code a PDF carries.
const OPTIONS = { isEvalSupported: false } as NonNullable<
  React.ComponentProps<typeof Document>['options']
>;

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

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-lg border bg-muted/30">
        <Document
          file={url}
          options={OPTIONS}
          onLoadSuccess={({ numPages }) => setPages(numPages)}
          onLoadError={onError}
          onSourceError={onError}
          loading={<p className="p-4 text-sm">Loading the preview…</p>}
        >
          <Page
            pageNumber={page}
            width={560}
            onRenderError={onError}
            onGetTextError={onError}
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
