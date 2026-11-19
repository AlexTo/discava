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
import { usePublicMediaUrl } from '../../../../hooks/usePublicMediaUrl';

export interface InstructorCardData {
  handle: string;
  displayName: string;
  headline?: string;
  photoKey?: string;
}

// Up to two letters from the first and last word of the name.
const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? [words[0], words[words.length - 1]].map((word) => word[0])
      : [words[0]?.[0] ?? '?'];
  return letters.join('').toUpperCase();
};

/**
 * One of a course's instructors: photo (or initials), name and headline. The
 * "View profile" text stays plain until the profile route exists. Every value
 * is rendered as text.
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
          <p className="mt-2 text-sm font-medium">View profile</p>
        </div>
      </CardContent>
    </Card>
  );
}
