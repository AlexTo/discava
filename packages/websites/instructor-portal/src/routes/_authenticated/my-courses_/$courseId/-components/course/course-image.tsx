/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { cn } from '@discava/common-shadcn/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper, { type Area } from 'react-easy-crop';
import { Alert } from '../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { usePublicMediaUrl } from '../../../../../../hooks/usePublicMediaUrl';
import { cropToJpeg } from './crop-to-jpeg';

// What the browser can draw onto a canvas to crop; whatever it is, it's
// stored as a JPEG (see cropToJpeg).
const ACCEPTED_IMAGE_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};
// The original never leaves the browser, so this only stops a file too big
// to crop comfortably.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** A course's 16:9 display image (#76), with a dialog to change it. */
export function CourseImage({
  courseId,
  imageKey,
  readOnly,
}: {
  courseId: string;
  imageKey?: string;
  /** An archived course can't be changed until it's restored. */
  readOnly: boolean;
}) {
  const imageUrl = usePublicMediaUrl()(imageKey);

  return (
    <div className="w-full space-y-2 sm:w-56">
      <CourseImagePreview src={imageUrl} />
      {!readOnly && (
        <CourseImageDialog
          courseId={courseId}
          currentImageUrl={imageUrl}
          trigger={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
            >
              {imageUrl ? 'Change image' : 'Add image'}
            </Button>
          }
        />
      )}
    </div>
  );
}

function CourseImagePreview({
  src,
  className,
}: {
  src?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground',
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex flex-col items-center gap-1 text-xs">
          <ImageIcon className="size-6" aria-hidden="true" />
          No course image
        </span>
      )}
    </div>
  );
}

function CourseImageDialog({
  courseId,
  currentImageUrl,
  trigger,
}: {
  courseId: string;
  currentImageUrl?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // An object URL for the picked file, which never leaves the browser
  // uncropped.
  const [source, setSource] = useState<string>();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'saving' | 'removing'>();
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  const { mutateAsync: createUploadUrl } = useMutation(
    course.createImageUploadUrl.mutationOptions(),
  );
  const { mutateAsync: updateImage } = useMutation(
    course.updateImage.mutationOptions(),
  );

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );

  const reset = () => {
    setSource(undefined);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(undefined);
    setError(undefined);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: MAX_SOURCE_BYTES,
    multiple: false,
    disabled: busy !== undefined,
    onDrop: ([file], [rejection]) => {
      if (rejection) {
        setError(
          rejection.errors[0]?.code === 'file-too-large'
            ? 'Choose an image under 20 MB.'
            : 'Choose a JPEG, PNG or WebP image.',
        );
        return;
      }
      if (file) {
        reset();
        setSource(URL.createObjectURL(file));
      }
    },
  });

  const finish = async () => {
    await queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
    setOpen(false);
    reset();
  };

  const save = async () => {
    if (!source || !area) return;
    setBusy('saving');
    setError(undefined);
    try {
      const image = await cropToJpeg(source, area);
      const { uploadUrl, imageKey, headers } = await createUploadUrl({
        courseId,
        contentLength: image.size,
      });
      // The upload URL was signed for exactly these headers and this size.
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: image,
      });
      if (!response.ok) {
        throw new Error("Couldn't upload the image. Please try again.");
      }
      await updateImage({ courseId, imageKey });
      await finish();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async () => {
    setBusy('removing');
    setError(undefined);
    try {
      await updateImage({ courseId, imageKey: null });
      await finish();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Course image</DialogTitle>
          <DialogDescription>
            Shown on course cards and the course page. Drag and zoom to choose
            the 16:9 area to use.
          </DialogDescription>
        </DialogHeader>

        {source ? (
          <div className="space-y-3">
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={16 / 9}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            </div>
            <label className="flex items-center gap-3 text-sm text-muted-foreground">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                disabled={busy !== undefined}
                className="w-full accent-primary"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            {currentImageUrl && <CourseImagePreview src={currentImageUrl} />}
            <div
              {...getRootProps()}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors hover:bg-accent/40',
                isDragActive && 'border-primary bg-accent/40',
              )}
            >
              <input {...getInputProps()} aria-label="Course image file" />
              <Upload className="size-5" aria-hidden="true" />
              <span>
                Drop an image here, or click to browse
                <br />
                JPEG, PNG or WebP, up to 20 MB
              </span>
            </div>
          </div>
        )}

        {error && (
          <Alert type="error" header="Couldn't save the image">
            {error}
          </Alert>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {source ? (
              <Button
                type="button"
                variant="ghost"
                onClick={reset}
                disabled={busy !== undefined}
              >
                Choose another image
              </Button>
            ) : (
              currentImageUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={remove}
                  disabled={busy !== undefined}
                >
                  {busy === 'removing' ? 'Removing...' : 'Remove image'}
                </Button>
              )
            )}
          </div>
          <Button
            type="button"
            onClick={save}
            disabled={!source || !area || busy !== undefined}
          >
            {busy === 'saving' ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
