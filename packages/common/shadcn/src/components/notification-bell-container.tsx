/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useCoreApi } from '../lib/core-api';
import {
  NotificationBell as Bell,
  type NotificationBellItem,
} from './notification-bell';

const PORTAL_ADDRESS_KEYS = {
  student: 'StudentPortal',
  instructor: 'InstructorPortal',
  admin: 'AdminPortal',
} as const;
const POLL_MS = 60_000;

export type Portal = NotificationBellItem['link']['portal'];

// The bell fed by core-api, for the portal it runs in: the unread count polls
// every minute and on window focus, the list loads when the popover opens.
// Links to this portal go through its router, others to the portal's address.
export const NotificationBell = ({ portal }: { portal: Portal }) => {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { portals } = useRuntimeConfig();
  const [open, setOpen] = useState(false);

  const countOptions = trpc.notification.unreadCount.queryOptions();
  const countQuery = useQuery({
    ...countOptions,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const listQuery = useInfiniteQuery(
    trpc.notification.list.infiniteQueryOptions(
      { limit: 20 },
      { enabled: open, getNextPageParam: (page) => page.nextCursor },
    ),
  );
  const items: NotificationBellItem[] =
    listQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: countOptions.queryKey });
    queryClient.invalidateQueries({
      queryKey: trpc.notification.list.pathKey(),
    });
  };
  const setCount = (unreadCount: number) =>
    queryClient.setQueryData(countOptions.queryKey, { unreadCount });

  const markRead = useMutation(
    trpc.notification.markRead.mutationOptions({
      onSuccess: ({ unreadCount }) => setCount(unreadCount),
      onError: refetchAll,
    }),
  );
  const markAllRead = useMutation(
    trpc.notification.markAllRead.mutationOptions({ onError: refetchAll }),
  );

  const onSelect = (item: NotificationBellItem) => {
    if (!item.read) {
      // Optimistic: the count drops now and is corrected by the response.
      setCount(Math.max(0, (countQuery.data?.unreadCount ?? 0) - 1));
      markRead.mutate({ position: item.position });
    }
    setOpen(false);
    if (item.link.portal === portal) {
      router.navigate({ to: item.link.path });
      return;
    }
    const address = portals?.[PORTAL_ADDRESS_KEYS[item.link.portal]];
    if (address) {
      window.location.assign(`${address.replace(/\/$/, '')}${item.link.path}`);
    }
  };

  const onMarkAllRead = async () => {
    const through = items[0]?.position;
    if (!through) return;
    setCount(0);
    try {
      let more = true;
      while (more) {
        const result = await markAllRead.mutateAsync({ through });
        more = result.more;
        setCount(result.unreadCount);
      }
    } catch {
      return; // onError has refetched the real state
    }
    queryClient.invalidateQueries({
      queryKey: trpc.notification.list.pathKey(),
    });
  };

  return (
    <Bell
      unreadCount={countQuery.data?.unreadCount ?? 0}
      items={items}
      isLoading={open && listQuery.isPending}
      isError={open && listQuery.isError}
      hasMore={listQuery.hasNextPage}
      open={open}
      onOpenChange={setOpen}
      onSelect={onSelect}
      onMarkAllRead={onMarkAllRead}
      onLoadMore={() => listQuery.fetchNextPage()}
      onRetry={() => listQuery.refetch()}
    />
  );
};
