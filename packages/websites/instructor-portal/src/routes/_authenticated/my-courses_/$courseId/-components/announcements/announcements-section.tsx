/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { RichTextView } from '@discava/common-shadcn/components/rich-text-view';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { AnnouncementForm } from './announcement-form';
import { DeleteAnnouncementDialog } from './delete-announcement-dialog';

const absoluteTime = (iso: string) => new Date(iso).toLocaleString();

/**
 * A course's announcements: the form to post one, and the list with edit and
 * delete on each. Not read-only for an archived course, which only loses the
 * form: its announcements can still be corrected or removed.
 */
export function AnnouncementsSection({
  courseId,
  archived,
}: {
  courseId: string;
  archived: boolean;
}) {
  const trpc = useInstructorApi();
  const [editingId, setEditingId] = useState<string>();
  const query = useInfiniteQuery(
    trpc.announcement.list.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      {archived ? (
        <p className="text-sm text-muted-foreground">
          Archived courses can't have new announcements.
        </p>
      ) : (
        <AnnouncementForm courseId={courseId} />
      )}

      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading announcements…</p>
      ) : query.isError ? (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-destructive">
            {apiErrorMessage(query.error, "Couldn't load the announcements.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No announcements yet.</p>
      ) : (
        <>
          <ul className="divide-y rounded-xl border">
            {items.map((item) => (
              <li key={item.announcementId} className="space-y-2 p-4">
                {editingId === item.announcementId ? (
                  <AnnouncementForm
                    courseId={courseId}
                    announcement={item}
                    onDone={() => setEditingId(undefined)}
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-balance font-medium">
                          {item.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          <time
                            dateTime={item.createdAt}
                            title={absoluteTime(item.createdAt)}
                          >
                            {absoluteTime(item.createdAt)}
                          </time>
                          {item.editedAt ? (
                            <>
                              {' '}
                              ·{' '}
                              <time
                                dateTime={item.editedAt}
                                title={absoluteTime(item.editedAt)}
                              >
                                edited {absoluteTime(item.editedAt)}
                              </time>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Edit ${item.title}`}
                          onClick={() => setEditingId(item.announcementId)}
                        >
                          Edit
                        </Button>
                        <DeleteAnnouncementDialog
                          courseId={courseId}
                          announcementId={item.announcementId}
                          title={item.title}
                          trigger={
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Delete ${item.title}`}
                            >
                              Delete
                            </Button>
                          }
                        />
                      </div>
                    </div>
                    <RichTextView value={item.body} />
                  </>
                )}
              </li>
            ))}
          </ul>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
