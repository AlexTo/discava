/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { BrandImageKind } from '@discava/common-branding/image-rules';
import {
  BRAND_IMAGE_RULES,
  checkBrandImage,
  checkBrandImageUpload,
} from '@discava/common-branding/image-rules';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useAdminApi } from '../../../api';
import { measureImage } from './measure-image';

export interface ImageFieldProps {
  kind: BrandImageKind;
  /** The section's heading, e.g. "Logo". */
  title: string;
  /** What the image is for, shown above the control. */
  help: string;
  /** The image shown now: the one in the form, or the default. */
  imageUrl: string;
  /** A message from the server about this image, shown beside the control. */
  serverError?: string;
  onUploaded: (key: string, previewUrl: string) => void;
  /** Called before a new file is checked, so an old server message is dropped. */
  onChoose?: () => void;
  /** The image's display box, so a logo is not cropped and an icon is square. */
  previewClassName: string;
}

// One brand image: the current picture, the rule it must meet, and a file
// control. A chosen file is checked in the browser first, then uploaded
// straight to storage; nothing visitors see changes until the form is saved.
export function ImageField({
  kind,
  title,
  help,
  imageUrl,
  serverError,
  onUploaded,
  onChoose,
  previewClassName,
}: ImageFieldProps) {
  const trpc = useAdminApi();
  const createUploadUrl = useMutation(
    trpc.branding.createUploadUrl.mutationOptions(),
  );
  const inputId = useId();
  const messageId = useId();
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const rules = BRAND_IMAGE_RULES[kind];

  const choose = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    onChoose?.();
    setError(undefined);
    const upload = checkBrandImageUpload({
      kind,
      contentType: file.type,
      bytes: file.size,
    });
    if (!upload.ok) {
      setError(upload.message);
      return;
    }
    const size = await measureImage(file);
    const checked = checkBrandImage({
      kind,
      contentType: file.type,
      bytes: file.size,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
    });
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setUploading(true);
    try {
      const { key, uploadUrl, headers } = await createUploadUrl.mutateAsync({
        kind,
        contentType: file.type as never,
        contentLength: file.size,
      });
      // The upload URL was signed for exactly these headers and this size.
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: file,
      });
      if (!response.ok) {
        throw new Error("Couldn't upload the file. Please try again.");
      }
      onUploaded(key, URL.createObjectURL(file));
    } catch (uploadError) {
      setError(apiErrorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  };

  const message = error ?? serverError;
  return (
    <section className="space-y-3" aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{help}</p>
      <div className="flex flex-wrap items-center gap-4">
        <img
          src={imageUrl}
          alt={`Current ${rules.label}`}
          className={previewClassName}
        />
        <div className="min-w-0 space-y-2">
          <Label htmlFor={inputId}>Upload {rules.label}</Label>
          <Input
            id={inputId}
            type="file"
            accept={rules.contentTypes.join(',')}
            aria-describedby={message ? messageId : undefined}
            aria-invalid={message ? true : undefined}
            disabled={uploading}
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              // So choosing the same file again after a refusal still runs.
              event.target.value = '';
            }}
          />
          <p className="text-xs text-muted-foreground">{rules.description}</p>
          {uploading && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Spinner /> Uploading…
            </p>
          )}
          {message && (
            <p
              id={messageId}
              role="alert"
              className="break-words text-sm text-destructive"
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
