/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { HlsVideo } from '@discava/common-shadcn/components/hls-video';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCoreApi } from '../../../../api';
import { CourseThumbnail } from '../../../../components/course-thumbnail';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * The course's preview video in the page header, in place of its image. The
 * image is the poster; the video's address (and its signed cookies) are asked
 * for only once the visitor presses play.
 */
export function CoursePreview({
  course,
  durationSeconds,
}: {
  course: { courseId: string; title: string; imageKey?: string };
  durationSeconds: number;
}) {
  const trpc = useCoreApi();
  const [requested, setRequested] = useState(false);
  const video = useQuery({
    ...trpc.course.previewVideoUrl.queryOptions({
      courseId: course.courseId,
    }),
    enabled: requested,
  });

  return (
    <div className="space-y-2">
      {video.data ? (
        <HlsVideo
          url={video.data.url}
          withCredentials={video.data.withCredentials}
          captions={video.data.captions}
          title={`Preview of ${course.title}`}
          className="aspect-video w-full overflow-hidden rounded-xl shadow-sm"
          autoPlay
        />
      ) : (
        <div className="relative">
          <CourseThumbnail course={course} className="rounded-xl shadow-sm" />
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30">
            {requested && video.isPending ? (
              <Spinner />
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRequested(true)}
              >
                Play preview
              </Button>
            )}
          </div>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Preview this course · {clock(durationSeconds)}
      </p>
      {video.isError && (
        <ErrorAlert type="error" header="Couldn't load the preview">
          {apiErrorMessage(video.error)}
        </ErrorAlert>
      )}
    </div>
  );
}
