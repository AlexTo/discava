/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Badge } from '@discava/common-shadcn/components/ui/badge';

// Marks a lesson an instructor has marked as a free preview. Marked is not
// open: anyone can open it only while the course is published and the lesson
// and its module are visible, so otherwise the badge says it isn't public yet.
export function FreePreviewBadge({ open }: { open: boolean }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] text-muted-foreground"
      title={
        open
          ? 'Anyone can open this lesson without enrolling'
          : 'Anyone will be able to open this lesson once it, its module and the course are published'
      }
    >
      {open ? 'Free preview' : 'Free preview (not public yet)'}
    </Badge>
  );
}
