/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { HlsVideo } from '@discava/common-shadcn/components/hls-video';
import { RichTextView } from '@discava/common-shadcn/components/rich-text-view';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, FileText, ListChecks, Play } from 'lucide-react';
import { Alert } from '../../../../components/alert';
import { Spinner } from '../../../../components/spinner';
import { useCoreApi } from '../../../../hooks/useCoreApi';
import { QuizItem } from './quiz-item';
import {
  errorCode,
  type PlayerItem,
  useCompleteItem,
} from './use-course-player';

export const ITEM_TYPES = {
  text: { label: 'Reading', icon: FileText },
  video: { label: 'Video', icon: Play },
  quiz: { label: 'Quiz', icon: ListChecks },
} as const;

// The element id a step in the step bar scrolls to.
export const itemAnchor = (contentItemId: string) => `item-${contentItemId}`;

// A ready video's stream. The URL comes with signed cookies valid for four
// hours, so it isn't refetched on focus or for an hour.
function VideoPlayer({ item }: { item: PlayerItem }) {
  const trpc = useCoreApi();
  const { courseId, moduleId, lessonId, contentItemId } = item;
  const videoQuery = useQuery(
    trpc.contentItem.videoUrl.queryOptions(
      { courseId, moduleId, lessonId, contentItemId },
      {
        enabled: item.status === 'ready',
        staleTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    ),
  );

  if (item.status === 'pending') {
    return (
      <Alert header="This video is still processing">
        Check back in a few minutes.
      </Alert>
    );
  }
  if (item.status === 'failed') {
    return (
      <Alert type="error" header="This video isn't available">
        Your instructor has been asked to upload it again.
      </Alert>
    );
  }
  if (videoQuery.isPending) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-muted">
        <Spinner />
      </div>
    );
  }
  if (videoQuery.isError) {
    return (
      <Alert type="error" header="Couldn't load this video">
        {videoQuery.error.message}
      </Alert>
    );
  }
  return (
    <HlsVideo
      url={videoQuery.data.url}
      title={item.title}
      className="aspect-video w-full rounded-xl bg-black"
    />
  );
}

// Text and video items are done when the student says so, never on their
// own. A quiz completes itself once passed or out of attempts.
function MarkAsDone({
  item,
  done,
  readOnly,
}: {
  item: PlayerItem;
  done: boolean;
  readOnly: boolean;
}) {
  const complete = useCompleteItem(item.courseId);

  if (done) {
    return (
      <Badge
        variant="secondary"
        className="gap-1.5 border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
      >
        <CircleCheck className="size-3.5" /> Done
      </Badge>
    );
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="outline"
        disabled={readOnly || complete.isPending}
        onClick={() =>
          complete.mutate({
            courseId: item.courseId,
            moduleId: item.moduleId,
            lessonId: item.lessonId,
            contentItemId: item.contentItemId,
          })
        }
      >
        <CircleCheck className="size-4" />
        {complete.isPending ? 'Saving…' : 'Mark as done'}
      </Button>
      {complete.error ? (
        <Alert type="error" header="Couldn't mark this as done">
          {errorCode(complete.error) === 'NOT_FOUND'
            ? 'This item is no longer available.'
            : complete.error.message}
        </Alert>
      ) : null}
    </div>
  );
}

// One content item of a lesson: its title, its content and, for text and
// video, Mark as done.
export function ContentItem({
  item,
  done,
  readOnly,
}: {
  item: PlayerItem;
  done: boolean;
  readOnly: boolean;
}) {
  const { label, icon: Icon } = ITEM_TYPES[item.type];
  return (
    <article
      id={itemAnchor(item.contentItemId)}
      aria-labelledby={`${itemAnchor(item.contentItemId)}-title`}
      className="scroll-mt-24 space-y-4"
    >
      <header>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </p>
        <h3
          id={`${itemAnchor(item.contentItemId)}-title`}
          className="mt-1 text-lg font-semibold"
        >
          {item.title}
        </h3>
        {item.description ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {item.description}
          </p>
        ) : null}
      </header>

      {item.type === 'text' ? (
        <RichTextView value={item.body} className="prose-base" />
      ) : null}
      {item.type === 'video' ? <VideoPlayer item={item} /> : null}
      {item.type === 'quiz' ? (
        <QuizItem item={item} readOnly={readOnly} />
      ) : null}

      {item.type === 'quiz' ? null : (
        <div className="flex justify-end">
          <MarkAsDone item={item} done={done} readOnly={readOnly} />
        </div>
      )}
    </article>
  );
}
