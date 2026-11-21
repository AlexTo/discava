/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { HlsVideo } from '@discava/common-shadcn/components/hls-video';
import { RichTextView } from '@discava/common-shadcn/components/rich-text-view';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@discava/common-shadcn/components/ui/item';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { fileKind, formatFileSize } from '@discava/common-web-utils/file-size';
import type { IFreePreviewItem } from '@discava/core-api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { useState } from 'react';
import { useCoreApi } from '../../../../api';
import { ITEM_TYPES, itemAnchor } from './content-item';

export type FreePreviewItemData = IFreePreviewItem;

// The tRPC error code a query failed with. Not taken from the course player's
// hook: a preview imports nothing that records progress.
export const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code;

type ItemRef = { courseId: string; moduleId: string; lessonId: string };

// The video's cookies last an hour; refetching every half hour keeps a long
// viewing going. The address stays the same, so the player is not remounted.
const VIDEO_REFETCH_MS = 30 * 60 * 1000;

// A preview video: a poster with Play. Nothing is requested until Play is
// pressed, so a page of previews signs nothing for a visitor who only reads.
function PreviewVideo({
  item,
  lesson,
}: {
  item: Extract<FreePreviewItemData, { type: 'video' }>;
  lesson: ItemRef;
}) {
  const trpc = useCoreApi();
  const [requested, setRequested] = useState(false);
  const video = useQuery(
    trpc.freePreview.videoUrl.queryOptions(
      { ...lesson, contentItemId: item.contentItemId },
      {
        enabled: requested,
        refetchInterval: VIDEO_REFETCH_MS,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: false,
        retry: false,
      },
    ),
  );

  if (!item.playable) {
    return (
      <ErrorAlert header="This video is being prepared.">
        Check back in a few minutes.
      </ErrorAlert>
    );
  }
  if (video.data) {
    return (
      <HlsVideo
        url={video.data.url}
        withCredentials={video.data.withCredentials}
        title={item.title}
        captions={video.data.captions}
        className="aspect-video w-full rounded-xl bg-black"
        autoPlay
      />
    );
  }
  if (video.isError) {
    return errorCode(video.error) === 'NOT_FOUND' ? (
      <ErrorAlert type="error" header="This video is not available">
        It may have been removed.
      </ErrorAlert>
    ) : (
      <ErrorAlert type="error" header="Couldn't load this video">
        {apiErrorMessage(video.error)}
      </ErrorAlert>
    );
  }
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl bg-muted">
      {requested ? (
        <Spinner />
      ) : (
        <Button type="button" onClick={() => setRequested(true)}>
          Play
        </Button>
      )}
    </div>
  );
}

// A file: its name and size, and a Download that asks for a fresh link when
// pressed, as the lesson page's does.
function PreviewFile({
  item,
  lesson,
}: {
  item: Extract<FreePreviewItemData, { type: 'file' }>;
  lesson: ItemRef;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [isFetching, setIsFetching] = useState(false);

  const download = async () => {
    setError(undefined);
    setIsFetching(true);
    try {
      const { url } = await queryClient.fetchQuery({
        ...trpc.freePreview.fileUrl.queryOptions({
          ...lesson,
          contentItemId: item.contentItemId,
        }),
        staleTime: 0,
        retry: false,
      });
      window.location.href = url;
    } catch (failure) {
      setError(failure);
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="space-y-3">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Paperclip />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{item.fileName}</ItemTitle>
          <ItemDescription>
            {fileKind(item.fileName)} · {formatFileSize(item.fileSize)}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            onClick={() => void download()}
            disabled={isFetching}
          >
            {isFetching ? 'Preparing…' : 'Download'}
          </Button>
        </ItemActions>
      </Item>
      {error ? (
        <ErrorAlert type="error" header="Couldn't download this file">
          {errorCode(error) === 'NOT_FOUND'
            ? 'This file is not available.'
            : apiErrorMessage(error)}
        </ErrorAlert>
      ) : null}
    </div>
  );
}

// One item of an open preview: its title and content, and nothing that
// records anything. A quiz is only described: it stays locked.
export function FreePreviewItem({
  item,
  lesson,
}: {
  item: FreePreviewItemData;
  lesson: ItemRef;
}) {
  const { label, icon: Icon } = ITEM_TYPES[item.type];
  const titleId = `${itemAnchor(item.contentItemId)}-title`;
  return (
    <article aria-labelledby={titleId} className="space-y-4">
      <header>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </p>
        <h2
          id={titleId}
          className="mt-1 min-w-0 break-words text-lg font-semibold"
        >
          {item.title}
        </h2>
        {item.description ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {item.description}
          </p>
        ) : null}
      </header>

      {item.type === 'text' ? (
        <RichTextView value={item.body} className="prose-base" />
      ) : null}
      {item.type === 'video' ? (
        <PreviewVideo item={item} lesson={lesson} />
      ) : null}
      {item.type === 'file' ? (
        <PreviewFile item={item} lesson={lesson} />
      ) : null}
      {item.type === 'quiz' ? (
        <Card>
          <CardContent className="space-y-1">
            <p className="font-medium">
              {item.questionCount === 1
                ? '1 question'
                : `${item.questionCount} questions`}
            </p>
            <p className="text-sm text-muted-foreground">
              Enrol to take this quiz
            </p>
          </CardContent>
        </Card>
      ) : null}
    </article>
  );
}
