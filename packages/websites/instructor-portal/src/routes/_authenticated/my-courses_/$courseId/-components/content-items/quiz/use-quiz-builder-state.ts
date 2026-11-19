/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { move } from '@dnd-kit/helpers';
import type { DragEndEvent } from '@dnd-kit/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useInstructorApi } from '../../../../../../../api';
import {
  fromQuizItem,
  hasErrors,
  newQuestion,
  newQuiz,
  type QuestionState,
  type QuizItem,
  type QuizState,
  toQuizInput,
  validateQuiz,
} from './quiz-form';

// What the save bar shows of a failed save.
export type SaveError = { message: string; data?: { code?: string } | null };

// The element id a contents link scrolls to.
export const sectionId = (target: string) => `quiz-section-${target}`;

// The builder's state: the quiz being edited, what is saved, the save and
// conflict mutations, the unsaved-changes guard and scroll-to.
export function useQuizBuilderState({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  quiz: existing,
  readOnly,
  onDirtyChange,
  onCreated,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId?: string;
  quiz?: QuizItem;
  readOnly: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onCreated?: (contentItemId: string) => void;
}) {
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const initial = useMemo(
    () => (existing ? fromQuizItem(existing) : newQuiz()),
    [existing],
  );
  const [quiz, setQuiz] = useState<QuizState>(initial);
  const [saved, setSaved] = useState<QuizState>(initial);
  // A new quiz has neither until its first save creates it.
  const [savedId, setSavedId] = useState(contentItemId);
  const [version, setVersion] = useState(existing?.quizVersion);
  const [expanded, setExpanded] = useState<string | undefined>(
    initial.questions[0]?.questionId,
  );
  const [showProblems, setShowProblems] = useState(false);
  // The question (or 'settings') to scroll to once it has rendered open.
  const [scrollTarget, setScrollTarget] = useState<string>();
  const [justSaved, setJustSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const createQuiz = useMutation(contentItem.createQuiz.mutationOptions());
  const updateQuiz = useMutation(contentItem.updateQuiz.mutationOptions());
  const saving = createQuiz.isPending || updateQuiz.isPending;
  const saveError: SaveError | null = createQuiz.error ?? updateQuiz.error;

  const errors = validateQuiz(quiz);
  const dirty = JSON.stringify(quiz) !== JSON.stringify(saved);

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
      .getElementById(sectionId(scrollTarget))
      // jsdom has no scrollIntoView.
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setScrollTarget(undefined);
  }, [scrollTarget]);

  // Opens a question (collapsing the open one) and scrolls to it.
  const jumpTo = (questionId: string) => {
    setExpanded(questionId);
    setScrollTarget(questionId);
  };

  const change = (next: Partial<QuizState>) => {
    setJustSaved(false);
    setQuiz((current) => ({ ...current, ...next }));
  };
  const changeSettings = (next: Partial<QuizState['settings']>) =>
    change({ settings: { ...quiz.settings, ...next } });
  const changeQuestion = (question: QuestionState) =>
    change({
      questions: quiz.questions.map((current) =>
        current.questionId === question.questionId ? question : current,
      ),
    });

  // Shows what needs fixing first, as saving does: a preview of an
  // incomplete quiz (no correct option, an empty prompt) can't be answered.
  const showProblemsFirst = () => {
    setShowProblems(true);
    const firstWithProblems = quiz.questions.find(
      ({ questionId }) => errors.questions[questionId],
    );
    if (firstWithProblems) {
      setExpanded(firstWithProblems.questionId);
    }
  };

  const preview = () => {
    if (hasErrors(errors)) {
      showProblemsFirst();
      return;
    }
    setPreviewOpen(true);
  };

  const save = async () => {
    createQuiz.reset();
    updateQuiz.reset();
    if (hasErrors(errors)) {
      showProblemsFirst();
      return;
    }
    const input = toQuizInput(quiz);
    try {
      const result =
        savedId === undefined || version === undefined
          ? await createQuiz.mutateAsync({
              courseId,
              moduleId,
              lessonId,
              ...input,
            })
          : await updateQuiz.mutateAsync({
              courseId,
              moduleId,
              lessonId,
              contentItemId: savedId,
              quizVersion: version,
              ...input,
            });
      // Once created, later saves update it.
      if (savedId === undefined) {
        onCreated?.(result.contentItemId);
      }
      setSavedId(result.contentItemId);
      setVersion(result.quizVersion);
      setSaved(quiz);
      setJustSaved(true);
      void queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
    } catch {
      // Shown below.
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (event.canceled) {
      return;
    }
    const ids = quiz.questions.map(({ questionId }) => questionId);
    const next = move(ids, event);
    change({
      questions: next.flatMap(
        (id) =>
          quiz.questions.find(({ questionId }) => questionId === id) ?? [],
      ),
    });
  };

  const addQuestion = () => {
    const question = newQuestion();
    change({ questions: [...quiz.questions, question] });
    jumpTo(question.questionId);
  };

  const removeQuestion = (questionId: string) =>
    change({
      questions: quiz.questions.filter(
        (current) => current.questionId !== questionId,
      ),
    });

  const toggleQuestion = (questionId: string) =>
    setExpanded((current) => (current === questionId ? undefined : questionId));

  return {
    quiz,
    errors,
    dirty,
    expanded,
    showProblems,
    justSaved,
    previewOpen,
    setPreviewOpen,
    saving,
    saveError,
    setScrollTarget,
    jumpTo,
    change,
    changeSettings,
    changeQuestion,
    addQuestion,
    removeQuestion,
    toggleQuestion,
    preview,
    save,
    onDragEnd,
  };
}
