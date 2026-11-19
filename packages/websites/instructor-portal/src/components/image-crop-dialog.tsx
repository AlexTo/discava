/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
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
import { Upload } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper, { type Area } from 'react-easy-crop';
import { cropToJpeg } from '../lib/crop-to-jpeg';

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

/**
 * A dialog to pick an image, crop it to `aspect` in the browser and hand the
 * JPEG (cut to `output`) to `onSave`, or to remove the current one. The
 * caller uploads and saves it; the dialog closes once that resolves, and shows
 * the message of an error it throws.
 */
export function ImageCropDialog({
  title,
  description,
  fileLabel,
  errorHeader,
  aspect,
  output,
  current,
  onSave,
  onRemove,
  removeLabel,
  trigger,
}: {
  title: string;
  description: string;
  /** The accessible name of the file input. */
  fileLabel: string;
  errorHeader: string;
  aspect: number;
  output: { width: number; height: number };
  /** Shows the image there is now; undefined when there is none. */
  current?: ReactNode;
  onSave: (image: Blob) => Promise<void>;
  onRemove: () => Promise<void>;
  removeLabel: string;
  trigger: ReactNode;
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

  const run = async (
    kind: 'saving' | 'removing',
    action: () => Promise<void>,
  ) => {
    setBusy(kind);
    setError(undefined);
    try {
      await action();
      setOpen(false);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const save = () => {
    if (!source || !area) return;
    return run('saving', async () =>
      onSave(await cropToJpeg(source, area, output)),
    );
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {source ? (
          <div className="space-y-3">
            <div
              className="relative mx-auto max-h-[50vh] w-full overflow-hidden rounded-lg bg-muted"
              style={{ aspectRatio: aspect }}
            >
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
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
            {current}
            <div
              {...getRootProps()}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors hover:bg-accent/40',
                isDragActive && 'border-primary bg-accent/40',
              )}
            >
              <input {...getInputProps()} aria-label={fileLabel} />
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
          <ErrorAlert type="error" header={errorHeader}>
            {error}
          </ErrorAlert>
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
              current && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => run('removing', onRemove)}
                  disabled={busy !== undefined}
                >
                  {busy === 'removing' ? 'Removing…' : removeLabel}
                </Button>
              )
            )}
          </div>
          <Button
            type="button"
            onClick={save}
            disabled={!source || !area || busy !== undefined}
          >
            {busy === 'saving' ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
