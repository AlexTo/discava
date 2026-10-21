/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Checkbox } from '@discava/common-shadcn/components/ui/checkbox';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@discava/common-shadcn/components/ui/select';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { cn } from '@discava/common-shadcn/lib/utils';
import { move } from '@dnd-kit/helpers';
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, Eye, Save } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Alert } from '../../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../../hooks/useInstructorApi';
import { QuestionCard, QuestionHandle } from './question-card';
import {
  fromQuizItem,
  hasErrors,
  MAX_QUESTIONS,
  newQuestion,
  newQuiz,
  plainText,
  type QuestionState,
  type QuizItem,
  type QuizState,
  type RevealAnswers,
  toQuizInput,
  validateQuiz,
} from './quiz-form';
import { QuizPreviewDialog } from './quiz-preview-dialog';

const REVEAL_LABELS: Record<RevealAnswers, string> = {
  after_each_attempt: 'After each attempt',
  after_final_attempt: 'After the last attempt',
  never: 'Never',
};

// Builds a new quiz or edits an existing one. The whole quiz -- settings,
// questions and answer key -- is saved together, so a save never pairs a new
// key with old questions.
export function QuizBuilder({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  quiz: existing,
  studentActivityCount = 0,
  readOnlyReason,
  onDirtyChange,
  onCreated,
  onReload,
  onClose,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  // Absent for a new quiz.
  contentItemId?: string;
  quiz?: QuizItem;
  // Students who have attempted it, for the warning about editing it.
  studentActivityCount?: number;
  // Why the quiz can't be edited (an archived course, module, lesson or
  // quiz), or nothing if it can.
  readOnlyReason?: string;
  // Whether there are unsaved changes, whenever that changes.
  onDirtyChange?: (dirty: boolean) => void;
  // After the first save of a new quiz, with the id it was given.
  onCreated?: (contentItemId: string) => void;
  // Fetches the quiz again, after a CONFLICT.
  onReload: () => void;
  // Shows a Close button beside Save, for a builder in a dialog.
  onClose?: () => void;
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
  const saveError = createQuiz.error ?? updateQuiz.error;
  const readOnly = Boolean(readOnlyReason);
  // Prefix for the settings fields' ids, which their labels point at.
  const ids = useId();

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

  return (
    <div className="space-y-6">
      {readOnlyReason && (
        <Alert header="This quiz can't be edited">{readOnlyReason}</Alert>
      )}
      {!readOnly && studentActivityCount > 0 && (
        <Alert
          header={`${studentActivityCount} ${studentActivityCount === 1 ? 'student has' : 'students have'} attempted this quiz`}
        >
          Their attempts and best scores are kept, and never regraded. Changing
          the questions makes anyone mid-attempt review the quiz before
          submitting; changing only the answer key or explanations doesn't
          interrupt them.
        </Alert>
      )}

      <div className="sm:grid sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6">
        <nav
          aria-label="Quiz contents"
          className="sticky top-0 hidden max-h-[calc(90vh-3rem)] self-start overflow-y-auto sm:block"
        >
          <ol className="space-y-0.5 text-sm">
            <li>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setScrollTarget('settings')}
                className="w-full justify-start px-2"
              >
                Settings
              </Button>
            </li>
            {quiz.questions.map((question, index) => {
              const needsFixing =
                showProblems && Boolean(errors.questions[question.questionId]);
              return (
                <li key={question.questionId}>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-current={
                      expanded === question.questionId ? 'true' : undefined
                    }
                    onClick={() => jumpTo(question.questionId)}
                    className={cn(
                      'h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left font-normal whitespace-normal',
                      expanded === question.questionId && 'bg-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">
                        Question {index + 1}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {plainText(question.prompt) ||
                          'No question written yet'}
                      </span>
                    </span>
                    {needsFixing && (
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-destructive">
                        <span className="sr-only">(needs fixing)</span>
                      </span>
                    )}
                  </Button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0 space-y-6">
          <section
            id={sectionId('settings')}
            aria-labelledby="quiz-settings"
            className="scroll-mt-4"
          >
            <Card className="gap-4 p-5">
              <CardHeader className="px-0">
                <CardTitle>
                  <h2 id="quiz-settings" className="text-lg">
                    Settings
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <fieldset
                  disabled={readOnly}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`${ids}-title`}>Title</Label>
                    <Input
                      id={`${ids}-title`}
                      value={quiz.title}
                      onChange={(event) =>
                        change({ title: event.target.value })
                      }
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`${ids}-description`}>
                      Description (optional)
                    </Label>
                    <Textarea
                      id={`${ids}-description`}
                      value={quiz.description}
                      onChange={(event) =>
                        change({ description: event.target.value })
                      }
                      rows={2}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${ids}-pass-mark`}>Pass mark (%)</Label>
                    <Input
                      id={`${ids}-pass-mark`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={
                        Number.isNaN(quiz.settings.passMarkPercent)
                          ? ''
                          : quiz.settings.passMarkPercent
                      }
                      onChange={(event) =>
                        changeSettings({
                          passMarkPercent: event.target.valueAsNumber,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">
                      Attempts allowed
                    </span>
                    <div className="flex h-9 items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${ids}-unlimited`}
                          checked={quiz.settings.attemptsAllowed === null}
                          onCheckedChange={(checked) =>
                            changeSettings({
                              attemptsAllowed: checked === true ? null : 3,
                            })
                          }
                          disabled={readOnly}
                        />
                        <Label
                          htmlFor={`${ids}-unlimited`}
                          className="font-normal"
                        >
                          Unlimited
                        </Label>
                      </div>
                      {quiz.settings.attemptsAllowed !== null && (
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          aria-label="Number of attempts"
                          className="w-24"
                          value={
                            Number.isNaN(quiz.settings.attemptsAllowed)
                              ? ''
                              : quiz.settings.attemptsAllowed
                          }
                          onChange={(event) =>
                            changeSettings({
                              attemptsAllowed: event.target.valueAsNumber,
                            })
                          }
                        />
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${ids}-reveal`}>
                      Show the correct answers
                    </Label>
                    <Select
                      value={quiz.settings.revealAnswers}
                      onValueChange={(value) =>
                        changeSettings({
                          revealAnswers: value as RevealAnswers,
                        })
                      }
                      disabled={readOnly}
                    >
                      <SelectTrigger id={`${ids}-reveal`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(REVEAL_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:h-9">
                    <Checkbox
                      id={`${ids}-shuffle`}
                      checked={quiz.settings.shuffleOptions}
                      onCheckedChange={(checked) =>
                        changeSettings({ shuffleOptions: checked === true })
                      }
                      disabled={readOnly}
                    />
                    <Label htmlFor={`${ids}-shuffle`} className="font-normal">
                      Shuffle the options for each student
                    </Label>
                  </div>
                </fieldset>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="quiz-questions" className="space-y-3">
            <h2 id="quiz-questions" className="text-lg font-semibold">
              Questions ({quiz.questions.length})
            </h2>
            <DragDropProvider onDragEnd={onDragEnd}>
              <ol className="space-y-3">
                {quiz.questions.map((question, index) => (
                  <SortableQuestion
                    key={question.questionId}
                    id={question.questionId}
                    elementId={sectionId(question.questionId)}
                    index={index}
                    label={`Question ${index + 1}`}
                    disabled={readOnly || quiz.questions.length < 2}
                  >
                    {(handle) => (
                      <QuestionCard
                        question={question}
                        number={index + 1}
                        expanded={expanded === question.questionId}
                        onToggle={() =>
                          setExpanded((current) =>
                            current === question.questionId
                              ? undefined
                              : question.questionId,
                          )
                        }
                        onChange={changeQuestion}
                        onRemove={() =>
                          change({
                            questions: quiz.questions.filter(
                              ({ questionId }) =>
                                questionId !== question.questionId,
                            ),
                          })
                        }
                        canRemove={quiz.questions.length > 1}
                        problems={
                          showProblems
                            ? (errors.questions[question.questionId] ?? [])
                            : []
                        }
                        readOnly={readOnly}
                        handle={handle}
                      />
                    )}
                  </SortableQuestion>
                ))}
              </ol>
            </DragDropProvider>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                disabled={quiz.questions.length >= MAX_QUESTIONS}
                onClick={() => {
                  const question = newQuestion();
                  change({ questions: [...quiz.questions, question] });
                  jumpTo(question.questionId);
                }}
              >
                <CirclePlus /> Add question
              </Button>
            )}
          </section>
        </div>
      </div>

      {(!readOnly || onClose) && (
        <div className="sticky bottom-0 space-y-3 border-t bg-background/95 py-4 backdrop-blur">
          {showProblems && errors.quiz.length > 0 && (
            <Alert type="error" header="Fix these before saving">
              <ul className="list-disc pl-5">
                {errors.quiz.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          )}
          {showProblems && Object.keys(errors.questions).length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {Object.keys(errors.questions).length === 1
                ? '1 question needs fixing'
                : `${Object.keys(errors.questions).length} questions need fixing`}{' '}
              before the quiz can be saved.
            </p>
          )}
          {saveError &&
            (saveError.data?.code === 'CONFLICT' ? (
              <Alert
                type="error"
                header="This quiz changed since you opened it"
              >
                <p>
                  Someone saved it in the meantime. Reload to get the latest
                  version; your unsaved changes here will be lost.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onReload}
                >
                  Reload the quiz
                </Button>
              </Alert>
            ) : (
              <Alert type="error" header="Couldn't save the quiz">
                {saveError.message}
              </Alert>
            ))}
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground" role="status">
              {justSaved ? 'Saved' : dirty ? 'Unsaved changes' : ''}
            </span>
            <Button type="button" variant="outline" onClick={preview}>
              <Eye /> Preview as student
            </Button>
            {onClose && (
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
            {!readOnly && (
              <Button type="button" disabled={saving} onClick={save}>
                <Save /> {saving ? 'Saving...' : 'Save quiz'}
              </Button>
            )}
          </div>
        </div>
      )}
      <QuizPreviewDialog
        quiz={quiz}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}

// The element id a contents link scrolls to.
const sectionId = (target: string) => `quiz-section-${target}`;

function SortableQuestion({
  id,
  elementId,
  index,
  label,
  disabled,
  children,
}: {
  id: string;
  elementId: string;
  index: number;
  label: string;
  disabled: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { ref, handleRef } = useSortable({ id, index, disabled });
  // The handle is always rendered, disabled when there's nothing to reorder:
  // without one, dnd-kit makes the whole card the drag source, a (disabled)
  // button to assistive tech, with every field inside it.
  return (
    <li ref={ref} id={elementId} className="scroll-mt-4">
      {children(
        <QuestionHandle
          label={label}
          handleRef={handleRef}
          disabled={disabled}
        />,
      )}
    </li>
  );
}
