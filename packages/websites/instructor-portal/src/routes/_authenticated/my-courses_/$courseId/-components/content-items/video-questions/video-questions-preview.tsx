/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HlsVideo,
  type PlayerCaption,
} from '@discava/common-shadcn/components/hls-video';
import { useVideoQuestions } from '@discava/common-shadcn/hooks/use-video-questions';
import {
  isCorrectAnswer,
  type VideoAnswer,
  type VideoQuestion,
} from '@discava/common-web-utils/video-questions';
import { useCallback, useMemo } from 'react';
import {
  fromVideoItem,
  sortQuestions,
  type VideoItem,
  type VideoQuestionState,
} from './video-questions-form';

// The questions as a learner is shown them. One whose time isn't a time yet
// is left out.
const toVideoQuestions = (questions: VideoQuestionState[]): VideoQuestion[] =>
  questions
    .filter((question) => !Number.isNaN(question.atSeconds))
    .map((question) => ({
      questionId: question.questionId,
      kind: question.kind,
      prompt: question.prompt,
      options: question.options,
      atSeconds: question.atSeconds,
      contentHash: '',
    }));

// The video as a learner sees it, with its questions asked and graded in the
// browser against the instructor's key. Nothing is sent: no API is called.
export function VideoQuestionsPreview({
  url,
  withCredentials,
  captions,
  questions,
  className,
}: {
  url: string;
  withCredentials: boolean;
  captions?: PlayerCaption[];
  questions: VideoQuestionState[];
  className?: string;
}) {
  const asked = useMemo(() => toVideoQuestions(questions), [questions]);
  const answers = useMemo(() => ({}), []);
  const submit = useCallback(
    async (
      question: VideoQuestion,
      optionIds: string[],
    ): Promise<VideoAnswer> => {
      const source = questions.find(
        ({ questionId }) => questionId === question.questionId,
      );
      const correctOptionIds = source?.correct ?? [];
      return {
        optionIds,
        correct: isCorrectAnswer(optionIds, correctOptionIds),
        correctOptionIds,
        explanation: source?.explanation || undefined,
      };
    },
    [questions],
  );
  const { cues, onCue, overlay, onOverlayDismiss } = useVideoQuestions({
    questions: asked,
    answers,
    submit,
  });
  return (
    <HlsVideo
      url={url}
      withCredentials={withCredentials}
      captions={captions}
      className={className}
      cues={cues}
      onCue={onCue}
      overlay={overlay}
      onOverlayDismiss={onOverlayDismiss}
    />
  );
}

// The questions a video was saved with, for previewing it.
export const savedQuestions = (video: VideoItem): VideoQuestionState[] =>
  sortQuestions(fromVideoItem(video));
