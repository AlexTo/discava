/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@discava/common-shadcn/components/ui/avatar';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import { usePublicMediaUrl } from '@discava/common-web-utils/public-media-url';
import { Link } from '@tanstack/react-router';
import { initialsOf } from '../../../../lib/initials';

export interface InstructorCardData {
  handle: string;
  displayName: string;
  headline?: string;
  photoKey?: string;
}

/**
 * One of a course's instructors: photo (or initials), name and headline. The
 * "View profile" link goes to the instructor's public profile. Every value is
 * rendered as text.
 */
export function InstructorCard({
  instructor,
}: {
  instructor: InstructorCardData;
}) {
  const photoUrl = usePublicMediaUrl()(instructor.photoKey);
  return (
    <Card className="py-0 shadow-sm">
      <CardContent className="flex items-start gap-4 p-5">
        <Avatar size="lg" className="size-16">
          {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
          <AvatarFallback aria-hidden="true" className="text-lg">
            {initialsOf(instructor.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h3 className="font-semibold">{instructor.displayName}</h3>
          {instructor.headline ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {instructor.headline}
            </p>
          ) : null}
          <Link
            to="/instructors/$handle"
            params={{ handle: instructor.handle }}
            className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View profile
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
