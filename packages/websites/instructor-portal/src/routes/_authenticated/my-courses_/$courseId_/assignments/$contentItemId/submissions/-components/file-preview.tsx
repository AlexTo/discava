/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { formatFileSize } from '@discava/common-web-utils/file-size';
import { useMutation } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useInstructorApi } from '../../../../../../../../api';

const PdfPreview = lazy(() =>
  import('./pdf-preview').then((m) => ({ default: m.PdfPreview })),
);

export interface PreviewFile {
  fileName: string;
  fileSize: number;
  mimeType: string;
  previewable: 'pdf' | 'image' | null;
}

// The submitted file: shown in the page when it's a PDF or an image, and
// always with its details and a Download button. The signed URL is fetched
// when the preview is shown (it expires in minutes), and again on Download.
export function FilePreview({
  courseId,
  contentItemId,
  userId,
  file,
}: {
  courseId: string;
  contentItemId: string;
  userId: string;
  file: PreviewFile;
}) {
  const trpc = useInstructorApi();
  const fileUrl = useMutation(
    trpc.assignmentSubmission.fileUrl.mutationOptions(),
  );
  const [failed, setFailed] = useState(false);
  const { mutate } = fileUrl;
  const previewable = file.previewable;

  useEffect(() => {
    setFailed(false);
    if (previewable) {
      mutate({ courseId, contentItemId, userId });
    }
  }, [mutate, previewable, courseId, contentItemId, userId, file.fileName]);

  const download = async () => {
    const { url } = await fileUrl.mutateAsync({
      courseId,
      contentItemId,
      userId,
    });
    const link = document.createElement('a');
    link.href = url;
    link.download = file.fileName;
    link.rel = 'noopener';
    link.click();
  };

  const url = fileUrl.data?.url;
  const canShow = previewable && !failed && !fileUrl.isError;
  let preview = null;
  if (canShow && !url) {
    preview = <Skeleton className="h-64 w-full" />;
  } else if (canShow && url && previewable === 'image') {
    preview = (
      <img
        src={url}
        alt={`Preview of ${file.fileName}`}
        className="max-h-[32rem] max-w-full rounded-lg border"
        onError={() => setFailed(true)}
      />
    );
  } else if (canShow && url) {
    preview = (
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PdfPreview url={url} onError={() => setFailed(true)} />
      </Suspense>
    );
  } else if (previewable) {
    preview = (
      <p role="alert" className="text-sm text-destructive">
        This file can't be previewed
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {preview}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{file.fileName}</span>
        <span className="text-muted-foreground">
          {file.mimeType} · {formatFileSize(file.fileSize)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void download().catch(() => undefined)}
          disabled={fileUrl.isPending && !previewable}
        >
          Download
        </Button>
      </div>
      {fileUrl.isError && !previewable ? (
        <p role="alert" className="text-sm text-destructive">
          {apiErrorMessage(fileUrl.error, "Couldn't get the file.")}
        </p>
      ) : null}
    </div>
  );
}
