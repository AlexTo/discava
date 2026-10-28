/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@discava/common-shadcn/components/ui/item';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { cn } from '@discava/common-shadcn/lib/utils';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { fileKind, formatFileSize } from '@discava/common-web-utils/file-size';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { type FileRejection, useDropzone } from 'react-dropzone';
import { Alert } from '../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';

// What a file item may be, as instructor-api allows it (its
// LESSON_FILE_TYPES): documents, spreadsheets, slides, plain text, images and
// zip archives (#102).
const ACCEPTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    '.xlsx',
  ],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    '.pptx',
  ],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'application/vnd.oasis.opendocument.presentation': ['.odp'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'text/markdown': ['.md'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/zip': ['.zip'],
};

const ALLOWED_LIST = Object.values(ACCEPTED_FILE_TYPES).flat().join(', ');

// As instructor-api's LESSON_FILE_MAX_BYTES.
const MAX_FILE_BYTES = 100 * 1024 * 1024;

type PendingUpload = {
  contentItemId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
};

// fetch() exposes no upload progress; XMLHttpRequest does. The headers are
// the ones the upload URL was signed with.
const putFileWithProgress = (
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error('Failed to upload the file'));
    xhr.onerror = () => reject(new Error('Failed to upload the file'));
    xhr.send(file);
  });

// Why the dropzone turned a file away.
const rejectionMessage = ([rejection]: FileRejection[]) =>
  rejection?.errors.some(({ code }) => code === 'file-too-large')
    ? `That file is larger than ${formatFileSize(MAX_FILE_BYTES)}.`
    : `That type of file can't be attached. Allowed: ${ALLOWED_LIST}.`;

// Adds a file item to a lesson (#102), or edits one: its title, description
// and, optionally, a replacement file. The file uploads as soon as it's
// chosen; Save attaches it.
export function AttachLessonFileDialog({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  description,
  fileName,
  fileSize,
  trigger,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  /** Set when editing an existing file item; omitted when adding one. */
  contentItemId?: string;
  title?: string;
  description?: string;
  /** The item's current file, when editing. */
  fileName?: string;
  fileSize?: number;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [titleValue, setTitleValue] = useState(title ?? '');
  // Whether the title has been typed in since the dialog opened. Once it has,
  // an upload finishing never changes it (#256).
  const titleTyped = useRef(false);
  const [descriptionValue, setDescriptionValue] = useState(description ?? '');
  const [pendingUpload, setPendingUpload] = useState<PendingUpload>();
  const [error, setError] = useState<string>();
  const [uploadProgress, setUploadProgress] = useState<number>();
  const isUploading = uploadProgress !== undefined;
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();

  const { mutateAsync: createUploadUrl } = useMutation(
    contentItem.createFileUploadUrl.mutationOptions(),
  );
  const { mutateAsync: createFileItem, isPending: isCreating } = useMutation(
    contentItem.createFile.mutationOptions(),
  );
  const { mutateAsync: updateFileItem, isPending: isUpdating } = useMutation(
    contentItem.updateFile.mutationOptions(),
  );
  const isSaving = isCreating || isUpdating;

  const uploadFile = async (file: File) => {
    setError(undefined);
    setUploadProgress(0);
    try {
      const {
        contentItemId: newContentItemId,
        uploadUrl,
        headers,
        objectKey,
      } = await createUploadUrl({
        courseId,
        moduleId,
        lessonId,
        fileName: file.name,
        fileSize: file.size,
        ...(contentItemId && { contentItemId }),
      });
      await putFileWithProgress(uploadUrl, headers, file, setUploadProgress);
      setPendingUpload({
        contentItemId: newContentItemId,
        objectKey,
        fileName: file.name,
        fileSize: file.size,
      });
      // A starting title, the name without its extension, unless there's a
      // title already or one was typed, even if only just: the upload can
      // finish between keystrokes, and the name would land among them.
      if (!titleTyped.current) {
        setTitleValue((current) =>
          current.trim() ? current : file.name.replace(/\.[^.]+$/, ''),
        );
      }
    } catch (failure) {
      setError(apiErrorMessage(failure, 'Failed to upload the file'));
    } finally {
      setUploadProgress(undefined);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) {
        setError(rejectionMessage(rejected));
        return;
      }
      const file = accepted[0];
      if (file) {
        void uploadFile(file);
      }
    },
    multiple: false,
    disabled: isUploading,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_FILE_BYTES,
  });

  const canSave =
    titleValue.trim().length > 0 &&
    !isUploading &&
    (contentItemId || pendingUpload);

  const handleSave = async () => {
    setError(undefined);
    try {
      if (contentItemId) {
        await updateFileItem({
          courseId,
          moduleId,
          lessonId,
          contentItemId,
          title: titleValue.trim(),
          description: descriptionValue || undefined,
          ...(pendingUpload && {
            objectKey: pendingUpload.objectKey,
            fileName: pendingUpload.fileName,
          }),
        });
      } else if (pendingUpload) {
        await createFileItem({
          courseId,
          moduleId,
          lessonId,
          contentItemId: pendingUpload.contentItemId,
          objectKey: pendingUpload.objectKey,
          fileName: pendingUpload.fileName,
          title: titleValue.trim(),
          description: descriptionValue || undefined,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
      setOpen(false);
    } catch (failure) {
      setError(apiErrorMessage(failure, "Couldn't save the file"));
    }
  };

  const shownFile = pendingUpload ?? (fileName ? { fileName, fileSize } : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          titleTyped.current = false;
          setTitleValue(title ?? '');
          setDescriptionValue(description ?? '');
          setPendingUpload(undefined);
        } else {
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contentItemId ? 'Edit file' : 'Add file'}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Attach a document for students to download: slides, a worksheet, a
            dataset.
          </p>
        </DialogHeader>

        {error && (
          <Alert type="error" header="Couldn't save the file">
            {error}
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="lesson-file-title">Title</Label>
          <Input
            id="lesson-file-title"
            value={titleValue}
            onChange={(event) => {
              titleTyped.current = true;
              setTitleValue(event.target.value);
            }}
            placeholder="e.g. Week 1 slides"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lesson-file-description">Description</Label>
          <Textarea
            id="lesson-file-description"
            value={descriptionValue}
            onChange={(event) => setDescriptionValue(event.target.value)}
            placeholder="Optional notes for students"
            rows={3}
          />
        </div>

        {shownFile && (
          <Item variant="outline" size="sm">
            <ItemMedia variant="icon">
              <Paperclip />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{shownFile.fileName}</ItemTitle>
              <ItemDescription>
                {fileKind(shownFile.fileName)}
                {shownFile.fileSize !== undefined &&
                  ` · ${formatFileSize(shownFile.fileSize)}`}
                {pendingUpload && ' · uploaded, Save to attach it'}
              </ItemDescription>
            </ItemContent>
            {contentItemId && !pendingUpload && (
              <ItemActions>
                <DownloadCurrentFile
                  courseId={courseId}
                  moduleId={moduleId}
                  lessonId={lessonId}
                  contentItemId={contentItemId}
                />
              </ItemActions>
            )}
          </Item>
        )}

        <div
          {...getRootProps()}
          className={cn(
            'cursor-pointer rounded-lg border border-dashed bg-muted/50 px-4 py-4 transition hover:border-primary hover:bg-primary/5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30',
            isUploading && 'pointer-events-none opacity-60',
          )}
        >
          <input {...getInputProps()} aria-label="File to attach" />
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-secondary p-2 text-secondary-foreground">
              <Upload className="size-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {isUploading
                  ? `Uploading... ${uploadProgress}%`
                  : contentItemId || pendingUpload
                    ? 'Drop a file or click to replace it'
                    : 'Drop a file or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isDragActive
                  ? 'Release to upload'
                  : `Up to ${formatFileSize(MAX_FILE_BYTES)}. Allowed: ${ALLOWED_LIST}`}
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

// Downloads the item's current file, through a fresh short-lived link.
function DownloadCurrentFile(key: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}) {
  const { contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const [isFetching, setIsFetching] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {failed && (
        <span className="text-xs text-destructive">Couldn't download it</span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isFetching}
        onClick={async () => {
          setFailed(false);
          setIsFetching(true);
          try {
            const { url } = await queryClient.fetchQuery({
              ...contentItem.createFileUrl.queryOptions(key),
              staleTime: 0,
            });
            window.location.href = url;
          } catch {
            setFailed(true);
          } finally {
            setIsFetching(false);
          }
        }}
      >
        {isFetching ? 'Preparing…' : 'Download'}
      </Button>
    </div>
  );
}
