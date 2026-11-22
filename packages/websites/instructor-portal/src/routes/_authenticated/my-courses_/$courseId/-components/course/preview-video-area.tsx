/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { HlsVideo } from '@discava/common-shadcn/components/hls-video';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { cn } from '@discava/common-shadcn/lib/utils';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import type { ICoursePreviewSummary } from '@discava/instructor-api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useInstructorApi } from '../../../../../../api';
import { putFileWithProgress } from '../../../../../../lib/put-file-with-progress';
import { ACCEPTED_VIDEO_TYPES } from '../content-items/attach-lesson-video-dialog';
import { CaptionTranslationsList } from '../content-items/caption-translations-list';
import { readVideoDuration } from './read-video-duration';

// The cap the API enforces (core-table's PREVIEW_MAX_SECONDS).
const MAX_SECONDS = 300;
const TOO_LONG = 'This video is longer than 5 minutes';

/**
 * The course's preview video, inside the landing page card: upload, replace
 * and remove act at once (they are not part of the card's Save), and a replaced
 * preview keeps playing its previous version until the new one is ready.
 */
export function PreviewVideoArea({
  courseId,
  preview,
  readOnly,
}: {
  courseId: string;
  preview?: ICoursePreviewSummary;
  readOnly?: boolean;
}) {
  const { course, coursePreview } = useInstructorApi();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isUploading = progress !== undefined;

  const { mutateAsync: createUploadUrl } = useMutation(
    coursePreview.createUploadUrl.mutationOptions(),
  );
  const { mutateAsync: createPreview } = useMutation(
    coursePreview.create.mutationOptions(),
  );
  const { mutateAsync: replacePreview } = useMutation(
    coursePreview.replace.mutationOptions(),
  );
  const {
    mutateAsync: removePreview,
    isPending: isRemoving,
    error: removeError,
    reset: resetRemove,
  } = useMutation(coursePreview.remove.mutationOptions());

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });

  // Polls course.view so the status moves on once the transcode finishes.
  useQuery({
    ...course.view.queryOptions({ courseId }),
    enabled: preview?.status === 'processing',
    refetchInterval: 3000,
  });

  const { data: video, isError: isVideoError } = useQuery({
    ...coursePreview.createVideoUrl.queryOptions({ courseId }),
    enabled: Boolean(preview?.hasPlayableVersion),
  });

  // The played version moves on when a replacement becomes ready (or a new
  // attempt starts), though the query's key does not: fetch its address again.
  const previewState = `${preview?.status}:${preview?.submissionNonce}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewState is the trigger
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: coursePreview.createVideoUrl.queryKey({ courseId }),
    });
  }, [previewState]);

  const upload = async (file: File) => {
    setError(undefined);
    let durationSeconds: number;
    try {
      durationSeconds = await readVideoDuration(file);
    } catch (readError) {
      setError(apiErrorMessage(readError, "Couldn't read the video"));
      return;
    }
    if (durationSeconds > MAX_SECONDS) {
      setError(TOO_LONG);
      return;
    }

    setProgress(0);
    try {
      const { uploadUrl, objectKey } = await createUploadUrl({
        courseId,
        fileName: file.name,
      });
      await putFileWithProgress(
        uploadUrl,
        { 'Content-Type': file.type },
        file,
        setProgress,
        'Failed to upload the video file',
      );
      const input = {
        courseId,
        rawKey: objectKey,
        durationSeconds: Math.max(1, Math.ceil(durationSeconds)),
      };
      if (preview) {
        await replacePreview({
          ...input,
          expectedSubmissionNonce: preview.submissionNonce,
        });
      } else {
        await createPreview(input);
      }
    } catch (uploadError) {
      setError(apiErrorMessage(uploadError, 'Failed to upload the video'));
    } finally {
      setProgress(undefined);
      // Also after a conflict, so the editor shows what is stored now.
      await refresh();
    }
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (files) => {
      if (files[0]) {
        void upload(files[0]);
      }
    },
    multiple: false,
    noClick: Boolean(preview),
    noKeyboard: Boolean(preview),
    disabled: isUploading || readOnly,
    accept: ACCEPTED_VIDEO_TYPES,
  });

  const remove = async () => {
    try {
      await removePreview({
        courseId,
        expectedSubmissionNonce: preview!.submissionNonce,
      });
    } catch {
      // Shown in the dialog from the mutation's error.
      await refresh();
      return;
    }
    setConfirmRemove(false);
    await refresh();
  };

  return (
    <section aria-labelledby="preview-video-heading" className="space-y-3">
      <div>
        <h3 id="preview-video-heading" className="text-sm font-medium">
          Preview video
        </h3>
        <p className="text-sm text-muted-foreground">
          A short video that sells the course. At most 5 minutes; 1 to 2 minutes
          works best. Captions are added automatically.
        </p>
      </div>

      {error && (
        <ErrorAlert type="error" header="Couldn't update the preview">
          {error}
        </ErrorAlert>
      )}
      {isVideoError && (
        <ErrorAlert type="error" header="Couldn't load the preview">
          The preview couldn't be loaded for playback.
        </ErrorAlert>
      )}

      {preview?.status === 'processing' && (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-6">
          <Spinner />
          <p className="text-sm text-muted-foreground">
            Processing video&hellip;
          </p>
          {preview.hasPlayableVersion && (
            <p className="px-4 text-center text-xs text-muted-foreground">
              Visitors still see the previous version until this one is ready.
            </p>
          )}
        </div>
      )}
      {preview?.status === 'failed' && (
        <ErrorAlert type="error" header="Video processing failed">
          {preview.failureReason === 'too-long'
            ? TOO_LONG
            : 'Something went wrong processing this video.'}{' '}
          {preview.hasPlayableVersion
            ? 'Visitors still see the previous version. '
            : ''}
          Upload a new file to try again.
        </ErrorAlert>
      )}
      {preview?.hasPlayableVersion && video && (
        <HlsVideo
          url={video.url}
          withCredentials={video.withCredentials}
          captions={video.captions}
          className="w-full rounded-lg border"
        />
      )}
      {preview?.hasPlayableVersion && video && (
        <CaptionTranslationsList translations={video.translations ?? []} />
      )}

      {!readOnly && (
        <div
          {...getRootProps()}
          className={cn(
            'rounded-lg border border-dashed bg-muted/50 px-4 py-4',
            !preview &&
              'cursor-pointer transition hover:border-primary hover:bg-primary/5',
            isUploading && 'pointer-events-none opacity-60',
          )}
        >
          <input {...getInputProps()} aria-label="Preview video file" />
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {isUploading
                ? `Uploading… ${progress}%`
                : preview
                  ? 'Upload a new file to replace the preview'
                  : 'Drop a video or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground">
              {isDragActive
                ? 'Release to upload'
                : 'Allowed: .mp4, .webm, .mov'}
            </p>
            {isUploading && (
              <Progress
                value={progress}
                className="h-1.5 bg-muted"
                aria-label="Upload progress"
              />
            )}
            {preview && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                  onClick={open}
                >
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={confirmRemove}
        onOpenChange={(next) => {
          setConfirmRemove(next);
          if (!next) {
            resetRemove();
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the preview video</AlertDialogTitle>
            <AlertDialogDescription>
              The public page goes back to showing the course image. This can't
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && (
            <ErrorAlert type="error" header="Couldn't remove the preview">
              {apiErrorMessage(removeError)}
            </ErrorAlert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={isRemoving}
              onClick={() => void remove()}
            >
              {isRemoving ? 'Removing…' : 'Remove video'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
