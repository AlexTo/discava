/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { cn } from '@discava/common-shadcn/lib/utils';
import { usePublicMediaUrl } from '@discava/common-web-utils/public-media-url';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageIcon } from 'lucide-react';
import { useInstructorApi } from '../../../../../../api';
import { ImageCropDialog } from '../../../../../../components/image-crop-dialog';
import { COURSE_IMAGE_SIZE } from '../../../../../../lib/crop-to-jpeg';

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
        <img
          src={src}
          alt=""
          width={640}
          height={360}
          className="size-full object-cover"
        />
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
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  const { mutateAsync: createUploadUrl } = useMutation(
    course.createImageUploadUrl.mutationOptions(),
  );
  const { mutateAsync: updateImage } = useMutation(
    course.updateImage.mutationOptions(),
  );

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });

  return (
    <ImageCropDialog
      title="Course image"
      description="Shown on course cards and the course page. Drag and zoom to choose the 16:9 area to use."
      fileLabel="Course image file"
      errorHeader="Couldn't save the image"
      aspect={16 / 9}
      output={COURSE_IMAGE_SIZE}
      current={
        currentImageUrl ? (
          <CourseImagePreview src={currentImageUrl} />
        ) : undefined
      }
      removeLabel="Remove image"
      trigger={trigger}
      onSave={async (image) => {
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
        await refresh();
      }}
      onRemove={async () => {
        await updateImage({ courseId, imageKey: null });
        await refresh();
      }}
    />
  );
}
