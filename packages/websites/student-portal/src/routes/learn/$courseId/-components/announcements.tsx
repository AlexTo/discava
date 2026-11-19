/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RichTextView } from '@discava/common-shadcn/components/rich-text-view';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCoreApi } from '../../../../api';

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60_000],
  ['month', 30 * 24 * 60 * 60_000],
  ['day', 24 * 60 * 60_000],
  ['hour', 60 * 60_000],
  ['minute', 60_000],
];

// "3 days ago", "just now" for under a minute.
const relativeTime = (iso: string) => {
  const elapsed = Date.now() - new Date(iso).getTime();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= size) {
      return formatter.format(-Math.round(elapsed / size), unit);
    }
  }
  return 'just now';
};

const absoluteTime = (iso: string) => new Date(iso).toLocaleString();

// Whether `body` is a Tiptap document at all; RichTextView renders one it
// can't read as nothing, which in a list would look like a missing body.
const isDocument = (body: string) => {
  try {
    return (JSON.parse(body) as { type?: unknown } | null)?.type === 'doc';
  } catch {
    return false;
  }
};

interface Item {
  announcementId: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
  editedAt?: string;
}

function AnnouncementRow({ item }: { item: Item }) {
  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      <h3 className="text-balance font-medium">{item.title}</h3>
      <p className="text-xs text-muted-foreground">
        {item.authorName} posted{' '}
        <time dateTime={item.createdAt} title={absoluteTime(item.createdAt)}>
          {relativeTime(item.createdAt)}
        </time>
        {item.editedAt ? (
          <>
            {' '}
            ·{' '}
            <time dateTime={item.editedAt} title={absoluteTime(item.editedAt)}>
              edited {relativeTime(item.editedAt)}
            </time>
          </>
        ) : null}
      </p>
      {isDocument(item.body) ? (
        <RichTextView value={item.body} />
      ) : (
        <p className="text-sm text-muted-foreground">
          This announcement could not be displayed.
        </p>
      )}
    </li>
  );
}

// A course's announcements, newest first, on its home. Its own errors stay in
// the card, so the rest of the course home keeps working.
export function Announcements({ courseId }: { courseId: string }) {
  const trpc = useCoreApi();
  const query = useInfiniteQuery(
    trpc.announcement.list.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">Announcements</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
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
          <p className="text-sm text-muted-foreground">
            Your instructor hasn't posted anything yet.
          </p>
        ) : (
          <>
            <ul className="divide-y">
              {items.map((item) => (
                <AnnouncementRow key={item.announcementId} item={item} />
              ))}
            </ul>
            {query.hasNextPage ? (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                Load more
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
