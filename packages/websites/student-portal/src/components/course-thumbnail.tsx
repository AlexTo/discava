/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { cn } from '@discava/common-shadcn/lib/utils';
import { usePublicMediaUrl } from '../hooks/usePublicMediaUrl';
import { toDisplayCourse } from '../lib/course-display';

/**
 * A course's 16:9 display image (#76), or, until its instructor adds one, a
 * placeholder of its own: a gradient with an icon, the same for the course
 * everywhere it's shown.
 */
export function CourseThumbnail({
  course,
  className,
  iconClassName,
}: {
  course: { courseId: string; title: string; imageKey?: string };
  className?: string;
  iconClassName?: string;
}) {
  const src = usePublicMediaUrl()(course.imageKey);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn('aspect-video w-full object-cover', className)}
      />
    );
  }
  const { icon, surface } = toDisplayCourse(course);
  return (
    <div
      className={cn(
        'flex aspect-video w-full items-center justify-center bg-gradient-to-br',
        surface,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'text-5xl font-semibold text-foreground/80',
          iconClassName,
        )}
      >
        {icon}
      </span>
    </div>
  );
}
