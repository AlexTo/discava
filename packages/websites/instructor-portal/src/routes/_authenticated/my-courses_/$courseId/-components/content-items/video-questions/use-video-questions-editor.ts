/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useInstructorApi } from '../../../../../../../api';
import {
  questionHeaderId,
  type SaveError,
} from '../quiz/use-quiz-builder-state';
import {
  canMove,
  fromVideoItem,
  hasErrors,
  MAX_VIDEO_QUESTIONS,
  moveWithinMoment,
  newVideoQuestion,
  sortQuestions,
  toVideoQuestionsInput,
  type VideoItem,
  type VideoQuestionState,
  validateVideoQuestions,
} from './video-questions-form';

// The element id a marker or contents link scrolls to.
export const questionElementId = (questionId: string) =>
  `video-question-${questionId}`;

// The id of a question's Move up or Move down button.
export const moveButtonId = (questionId: string, direction: 'up' | 'down') =>
  `video-question-move-${direction}-${questionId}`;

// Focuses an element once the list has re-rendered.
const focusLater = (id: string) =>
  setTimeout(() => document.getElementById(id)?.focus());

// The editor's state: the questions being edited, what is saved, the save
// mutation and its version, the unsaved-changes guard and scroll-to.
export function useVideoQuestionsEditor({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  video,
  readOnly,
  onDirtyChange,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  video: VideoItem;
  readOnly: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const initial = useMemo(() => sortQuestions(fromVideoItem(video)), [video]);
  const [questions, setQuestions] = useState<VideoQuestionState[]>(initial);
  const [saved, setSaved] = useState<VideoQuestionState[]>(initial);
  // 0 for a video that has never had questions.
  const [version, setVersion] = useState(video.quizVersion ?? 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [expanded, setExpanded] = useState<string>();
  const [showProblems, setShowProblems] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<string>();
  const [justSaved, setJustSaved] = useState(false);
  const update = useMutation(
    contentItem.updateVideoQuestions.mutationOptions(),
  );
  const saveError: SaveError | null = update.error;

  const errors = validateVideoQuestions(questions);
  const dirty = JSON.stringify(questions) !== JSON.stringify(saved);
  const atLimit = questions.length >= MAX_VIDEO_QUESTIONS;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty || readOnly) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, readOnly]);

  useEffect(() => {
    if (!scrollTarget) {
      return;
    }
    document
      .getElementById(questionElementId(scrollTarget))
      // jsdom has no scrollIntoView.
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setScrollTarget(undefined);
  }, [scrollTarget]);

  const change = (next: VideoQuestionState[]) => {
    setJustSaved(false);
    setQuestions(next);
  };

  const jumpTo = (questionId: string) => {
    setExpanded(questionId);
    setScrollTarget(questionId);
  };

  // A new question goes in asking order: after those already asked at the
  // same moment.
  const add = (atSeconds: number | null) => {
    if (atLimit) {
      return;
    }
    const question = newVideoQuestion(atSeconds);
    change(sortQuestions([...questions, question]));
    jumpTo(question.questionId);
  };

  const addHere = () => add(Math.floor(currentTime));
  const addAtEnd = () => add(null);

  const changeQuestion = (question: VideoQuestionState) => {
    const before = questions.find((q) => q.questionId === question.questionId);
    const next = questions.map((q) =>
      q.questionId === question.questionId ? question : q,
    );
    // Only a new time re-sorts, so editing a card never moves it.
    change(
      before?.atSeconds === question.atSeconds ? next : sortQuestions(next),
    );
  };

  const remove = (questionId: string) => {
    const index = questions.findIndex((q) => q.questionId === questionId);
    const remaining = questions.filter((q) => q.questionId !== questionId);
    change(remaining);
    // Focus the question that took its place, else the one before it.
    const neighbour = remaining[index] ?? remaining[index - 1];
    if (neighbour) {
      focusLater(questionHeaderId(neighbour.questionId));
    }
  };

  const move = (questionId: string, direction: 'up' | 'down') => {
    const next = moveWithinMoment(questions, questionId, direction);
    change(next);
    // The button just used keeps focus unless it is now disabled, when the
    // other one takes it.
    const other = direction === 'up' ? 'down' : 'up';
    focusLater(
      moveButtonId(
        questionId,
        canMove(next, questionId, direction) ? direction : other,
      ),
    );
  };

  const toggle = (questionId: string) =>
    setExpanded((current) => (current === questionId ? undefined : questionId));

  const save = async () => {
    update.reset();
    if (hasErrors(errors)) {
      setShowProblems(true);
      const first = questions.find(
        ({ questionId }) => errors.questions[questionId],
      );
      if (first) {
        jumpTo(first.questionId);
      }
      return;
    }
    try {
      const result = await update.mutateAsync({
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        ...toVideoQuestionsInput(questions, version),
      });
      setVersion(result.quizVersion ?? version + 1);
      setSaved(questions);
      setJustSaved(true);
      setShowProblems(false);
      void queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
    } catch {
      // Shown below.
    }
  };

  return {
    questions,
    errors,
    dirty,
    atLimit,
    expanded,
    showProblems,
    justSaved,
    saving: update.isPending,
    saveError,
    currentTime,
    setCurrentTime,
    addHere,
    addAtEnd,
    jumpTo,
    changeQuestion,
    remove,
    move,
    toggle,
    save,
  };
}
