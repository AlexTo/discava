/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { HlsVideo } from '@discava/common-shadcn/components/hls-video';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { cn } from '@discava/common-shadcn/lib/utils';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Alert } from '../../../../../../components/alert';
import { Spinner } from '../../../../../../components/spinner';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { studentActivityNote } from '../student-activity';

const ACCEPTED_VIDEO_TYPES = {
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
};

type PendingUpload = {
  contentItemId: string;
  objectKey: string;
  mimeType: string;
};

// fetch() exposes no upload progress; XMLHttpRequest does via
// xhr.upload.onprogress, hence the lower-level API here instead of fetch.
const putFileWithProgress = (
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error('Failed to upload the video file'));
      }
    };
    xhr.onerror = () => reject(new Error('Failed to upload the video file'));
    xhr.send(file);
  });

export function AttachLessonVideoDialog({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  description,
  status,
  hasPreviousVersion = false,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  /** Set when editing an existing video; omitted when attaching a new one. */
  contentItemId?: string;
  title?: string;
  description?: string;
  /** The video's transcode status, if this is an existing video. */
  status?: string;
  /**
   * Whether students still have the version being replaced to play while
   * this one is processing, or after it failed (#209).
   */
  hasPreviousVersion?: boolean;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [titleValue, setTitleValue] = useState(title ?? '');
  const [descriptionValue, setDescriptionValue] = useState(description ?? '');
  const [pendingUpload, setPendingUpload] = useState<PendingUpload>();
  const [uploadError, setUploadError] = useState<string>();
  const [uploadProgress, setUploadProgress] = useState<number>();
  const isUploading = uploadProgress !== undefined;
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();

  const { mutateAsync: createUploadUrl } = useMutation(
    contentItem.createVideoUploadUrl.mutationOptions(),
  );
  const { mutateAsync: createLessonContentItem, isPending: isCreating } =
    useMutation(contentItem.createVideo.mutationOptions());
  const { mutateAsync: updateLessonContentItem, isPending: isUpdating } =
    useMutation(contentItem.updateVideo.mutationOptions());
  const isSaving = isCreating || isUpdating;

  const isPendingTranscode = Boolean(contentItemId) && status === 'pending';
  const isFailedTranscode = Boolean(contentItemId) && status === 'failed';

  const {
    data: video,
    isPending: isLoadingVideo,
    isError: isVideoError,
  } = useQuery({
    ...contentItem.createVideoUrl.queryOptions({
      courseId,
      moduleId,
      lessonId,
      contentItemId: contentItemId ?? '',
    }),
    enabled:
      open &&
      Boolean(contentItemId) &&
      !pendingUpload &&
      !isPendingTranscode &&
      !isFailedTranscode,
  });

  // Polls course.view so `status` updates once the transcode finishes.
  useQuery({
    ...course.view.queryOptions({ courseId }),
    enabled: open && isPendingTranscode,
    refetchInterval: 3000,
  });

  const invalidateCourse = () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });

  const uploadFile = async (file: File) => {
    setUploadError(undefined);
    setUploadProgress(0);
    try {
      const {
        contentItemId: newContentItemId,
        uploadUrl,
        objectKey,
      } = await createUploadUrl({
        courseId,
        moduleId,
        lessonId,
        fileName: file.name,
        // Replacing an existing video: reuse its id so the uploaded
        // object's key matches the content item being updated.
        ...(contentItemId && { contentItemId }),
      });

      await putFileWithProgress(uploadUrl, file, setUploadProgress);

      setPendingUpload({
        contentItemId: newContentItemId,
        objectKey,
        mimeType: file.type,
      });
    } catch (error) {
      setUploadError(apiErrorMessage(error, 'Failed to upload the video'));
    } finally {
      setUploadProgress(undefined);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (file) {
        void uploadFile(file);
      }
    },
    multiple: false,
    disabled: isUploading,
    accept: ACCEPTED_VIDEO_TYPES,
  });

  const canSave =
    titleValue.trim().length > 0 &&
    !isUploading &&
    (contentItemId || pendingUpload);

  const handleSave = async () => {
    setUploadError(undefined);
    try {
      if (contentItemId) {
        await updateLessonContentItem({
          courseId,
          moduleId,
          lessonId,
          contentItemId,
          title: titleValue.trim(),
          description: descriptionValue || undefined,
          ...(pendingUpload && {
            objectKey: pendingUpload.objectKey,
            mimeType: pendingUpload.mimeType,
          }),
        });
      } else if (pendingUpload) {
        await createLessonContentItem({
          courseId,
          moduleId,
          lessonId,
          contentItemId: pendingUpload.contentItemId,
          objectKey: pendingUpload.objectKey,
          mimeType: pendingUpload.mimeType,
          title: titleValue.trim(),
          description: descriptionValue || undefined,
        });
      }
      await invalidateCourse();
      setOpen(false);
    } catch (error) {
      setUploadError(apiErrorMessage(error, "Couldn't save the video"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setTitleValue(title ?? '');
          setDescriptionValue(description ?? '');
          setPendingUpload(undefined);
        }
        if (!nextOpen) {
          setUploadError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {contentItemId ? 'Edit video' : 'Add video'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Attach an MP4, WebM, or MOV video for students to watch in this
            lesson.
          </p>
        </DialogHeader>

        {uploadError && (
          <Alert type="error" header="Couldn't save the video">
            {uploadError}
          </Alert>
        )}
        {isVideoError && (
          <Alert type="error" header="Couldn't load the video">
            The attached video couldn't be loaded for playback.
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="lesson-video-title">Title</Label>
          <Input
            id="lesson-video-title"
            value={titleValue}
            onChange={(event) => setTitleValue(event.target.value)}
            placeholder="e.g. Course overview"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lesson-video-description">Description</Label>
          <Textarea
            id="lesson-video-description"
            value={descriptionValue}
            onChange={(event) => setDescriptionValue(event.target.value)}
            placeholder="Optional notes for students"
            rows={3}
          />
        </div>

        {contentItemId &&
          !pendingUpload &&
          (isPendingTranscode ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border py-6">
              <Spinner />
              <p className="text-sm text-muted-foreground">
                Processing video&hellip;
              </p>
              {hasPreviousVersion ? (
                <p className="px-4 text-center text-xs text-muted-foreground">
                  Students still see the previous version until this one is
                  ready.
                </p>
              ) : null}
            </div>
          ) : isFailedTranscode ? (
            <Alert type="error" header="Video processing failed">
              Something went wrong processing this video.{' '}
              {hasPreviousVersion
                ? 'Students still see the previous version. '
                : ''}
              Drop a new file below to retry.
            </Alert>
          ) : isLoadingVideo ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            video && (
              <HlsVideo
                url={video.url}
                withCredentials={video.withCredentials}
                className="w-full rounded-lg border"
              />
            )
          ))}

        <div
          {...getRootProps()}
          className={cn(
            'cursor-pointer rounded-lg border border-dashed bg-muted/50 px-4 py-4 transition hover:border-primary hover:bg-primary/5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30',
            isUploading && 'pointer-events-none opacity-60',
          )}
        >
          <input {...getInputProps()} />
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-secondary p-2 text-secondary-foreground">
              <Upload className="size-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {isUploading
                  ? `Uploading... ${uploadProgress}%`
                  : pendingUpload
                    ? 'Video uploaded — click Save to attach it'
                    : contentItemId
                      ? 'Drop a video or click to replace the file'
                      : 'Drop a video or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isDragActive
                  ? 'Release to upload'
                  : 'Allowed: .mp4, .webm, .mov'}
              </p>
              {isUploading && (
                <Progress
                  value={uploadProgress}
                  className="h-1.5 bg-muted"
                  aria-label="Upload progress"
                />
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSave || isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirms before removing a video from a lesson, same treatment as
 * DeleteLessonDialog/DeleteModuleDialog give lessons and modules.
 */
export function RemoveLessonVideoButton({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  archive,
  students = 0,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  title: string;
  // Outside a draft course, removing archives the video instead: students
  // stop seeing it, but it and their data for it are kept and restorable.
  archive: boolean;
  // How many students have used it, for the warning on archiving.
  students?: number;
}) {
  const [open, setOpen] = useState(false);
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const {
    mutateAsync: removeContentItem,
    reset: resetRemoveContentItem,
    isPending,
    isError,
    error,
  } = useMutation(contentItem.delete.mutationOptions());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetRemoveContentItem();
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={`Remove ${title}`}
          className="-ml-2 transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {archive ? 'Archive video' : 'Remove video'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {archive
              ? `Students will no longer see "${title}". Their progress is kept, and the video can be restored.`
              : `Are you sure you want to remove "${title}"? This can't be undone.`}
          </AlertDialogDescription>
          {archive && studentActivityNote({ students }) && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {studentActivityNote({ students })}. Their progress is kept, and
              counts again if it's restored.
            </p>
          )}
        </AlertDialogHeader>

        {isError && (
          <Alert
            type="error"
            header={
              archive
                ? "Couldn't archive the video"
                : "Couldn't remove the video"
            }
          >
            {apiErrorMessage(error)}
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={archive ? 'default' : 'destructive'}
            disabled={isPending}
            onClick={async () => {
              try {
                await removeContentItem({
                  courseId,
                  moduleId,
                  lessonId,
                  contentItemId,
                });
              } catch {
                // Surfaced via the error above; keep the dialog open.
                return;
              }
              setOpen(false);
              void queryClient.invalidateQueries({
                queryKey: course.view.queryKey({ courseId }),
              });
            }}
          >
            {archive
              ? isPending
                ? 'Archiving...'
                : 'Archive video'
              : isPending
                ? 'Removing...'
                : 'Remove video'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
