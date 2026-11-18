/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Bell } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Skeleton } from './ui/skeleton';

export interface NotificationBellItem {
  // The opaque sort key: the notification's id.
  position: string;
  type: string;
  title: string;
  body: string;
  link: { portal: 'student' | 'instructor' | 'admin'; path: string };
  occurredAt: string;
  read: boolean;
}

export interface NotificationBellProps {
  unreadCount: number;
  items: NotificationBellItem[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  // Controlled by the portal, which closes the list when an item is selected.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: NotificationBellItem) => void;
  onMarkAllRead: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relativeTime = (iso: string, now = Date.now()) => {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.trunc(seconds / size), unit);
    }
  }
  return 'just now';
};

// The bell in a portal's header: a badge with the unread count, and a popover
// listing the newest notifications. Presentational; the portal supplies the
// data and what selecting an item does.
export function NotificationBell({
  unreadCount,
  items,
  isLoading,
  isError,
  hasMore,
  open,
  onOpenChange,
  onSelect,
  onMarkAllRead,
  onLoadMore,
  onRetry,
}: NotificationBellProps) {
  const label =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications';

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={label}
        >
          <Bell />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={onMarkAllRead}
          >
            Mark all as read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-3" data-testid="notification-skeleton">
              {[0, 1, 2].map((row) => (
                <div key={row} className="space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="space-y-2 p-4 text-center text-sm">
              <p role="alert">We couldn't load your notifications.</p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.position} className="border-b last:border-b-0">
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                    onClick={() => onSelect(item)}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        item.read ? 'bg-transparent' : 'bg-primary'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm ${
                          item.read ? 'font-normal' : 'font-semibold'
                        }`}
                      >
                        {!item.read ? (
                          <span className="sr-only">Unread: </span>
                        ) : null}
                        {item.title}
                      </span>
                      <span className="line-clamp-2 block text-sm text-muted-foreground">
                        {item.body}
                      </span>
                      <time
                        className="block text-xs text-muted-foreground"
                        dateTime={item.occurredAt}
                        title={new Date(item.occurredAt).toLocaleString()}
                      >
                        {relativeTime(item.occurredAt)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && !isLoading && !isError ? (
            <div className="p-2 text-center">
              <Button variant="ghost" size="sm" onClick={onLoadMore}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
