/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { HlsVideo } from '@discava/common-shadcn/components/hls-video';
import {
  useVideoQuestions,
  type VideoAnswerFailure,
} from '@discava/common-shadcn/hooks/use-video-questions';
import type {
  VideoAnswer,
  VideoQuestion,
} from '@discava/common-web-utils/video-questions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { useCoreApi } from '../../../../api';
import {
  errorCode,
  type PlayerItem,
} from '../../../../hooks/use-course-player';

const REMOVED_MESSAGE = 'This question is no longer part of the video';

const NO_QUESTIONS: VideoQuestion[] = [];
const NO_ANSWERS: Record<string, VideoAnswer> = {};

// A video whose questions the learner is asked as it plays: the questions and
// the learner's answers come from videoQuestion.view, and each answer is
// recorded by videoQuestion.answer and written into the cached view. While
// the questions load, or if they fail to, the video plays without them.
export function VideoWithQuestions({
  item,
  ...video
}: { item: PlayerItem } & Omit<
  ComponentProps<typeof HlsVideo>,
  'cues' | 'onCue' | 'overlay' | 'onOverlayDismiss'
>) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const { courseId, moduleId, lessonId, contentItemId } = item;
  const ref = { courseId, moduleId, lessonId, contentItemId };
  const viewKey = trpc.videoQuestion.view.queryKey(ref);
  const viewQuery = useQuery(
    trpc.videoQuestion.view.queryOptions(ref, {
      refetchOnWindowFocus: false,
    }),
  );
  const answer = useMutation(trpc.videoQuestion.answer.mutationOptions());
  const { refetch } = viewQuery;

  const questions = (viewQuery.data?.questions ??
    NO_QUESTIONS) as VideoQuestion[];
  const answers = viewQuery.data?.answers ?? NO_ANSWERS;

  const submit = async (
    question: VideoQuestion,
    optionIds: string[],
  ): Promise<VideoAnswer> => {
    try {
      const { recorded: _recorded, ...result } = await answer.mutateAsync({
        ...ref,
        questionId: question.questionId,
        optionIds,
        contentHash: question.contentHash,
      });
      queryClient.setQueryData(viewKey, (cached) =>
        cached
          ? {
              ...cached,
              answers: { ...cached.answers, [question.questionId]: result },
            }
          : cached,
      );
      return result;
    } catch (error) {
      const failure: VideoAnswerFailure = {
        kind:
          errorCode(error) === 'CONFLICT'
            ? 'updated'
            : errorCode(error) === 'NOT_FOUND' &&
                (error as Error).message === REMOVED_MESSAGE
              ? 'removed'
              : 'failed',
      };
      throw failure;
    }
  };

  const { cues, onCue, overlay, onOverlayDismiss } = useVideoQuestions({
    questions,
    answers,
    submit,
    onChanged: () => void refetch(),
  });

  return (
    <HlsVideo
      {...video}
      cues={cues}
      onCue={onCue}
      overlay={overlay}
      onOverlayDismiss={onOverlayDismiss}
    />
  );
}
