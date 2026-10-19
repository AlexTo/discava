/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@discava/common-shadcn/components/ui/collapsible';
import { Label } from '@discava/common-shadcn/components/ui/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@discava/common-shadcn/components/ui/radio-group';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  ListChecks,
  Paperclip,
  Play,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { useCoreApi } from '../../hooks/useCoreApi';
import { toDisplayCourse } from '../../lib/course-display';

interface Attachment {
  name: string;
  kind: 'doc' | 'csv';
  sizeLabel: string;
  content: string;
  mimeType: string;
}

interface BaseLesson {
  lessonId: string;
  title: string;
  minutes: number;
  attachments?: Attachment[];
}

interface TextLesson extends BaseLesson {
  type: 'text';
  paragraphs: string[];
}

interface ImageLesson extends BaseLesson {
  type: 'image';
  emoji: string;
  surface: string;
  caption: string;
}

interface VideoLesson extends BaseLesson {
  type: 'video';
  surface: string;
  transcript: string;
}

interface QuizLesson extends BaseLesson {
  type: 'quiz';
  dueDate: string;
  attemptsAllowed: number;
  question: string;
  options: string[];
  correctIndex: number;
}

type Lesson = TextLesson | ImageLesson | VideoLesson | QuizLesson;

interface Module {
  moduleId: string;
  title: string;
  lessons: Lesson[];
}

// This page doesn't have a backend for lesson content yet, so the module
// and lesson list below is the same illustrative structure for every course
// — only the header (title/description/icon) comes from the real course.
const modules: Module[] = [
  {
    moduleId: 'm1',
    title: 'Getting started',
    lessons: [
      {
        lessonId: 'l1',
        type: 'text',
        title: 'Welcome to the course',
        minutes: 4,
        paragraphs: [
          "Welcome! This module gets you oriented before we dive into the core material — what you'll learn, how the course is structured, and how to get the most out of each lesson.",
          'Work through the modules in order on the left. Each lesson is short by design, so you can fit learning into small pockets of time.',
        ],
        attachments: [
          {
            name: 'Course syllabus.txt',
            kind: 'doc',
            sizeLabel: '2 KB',
            mimeType: 'text/plain',
            content:
              'Course syllabus\n\n1. Getting started\n2. Core concepts\n3. Applying your skills\n\nEach module builds on the last — work through them in order for the best result.',
          },
        ],
      },
      {
        lessonId: 'l2',
        type: 'video',
        title: 'Course overview',
        minutes: 6,
        surface: 'from-blue-500/20 to-indigo-500/5',
        transcript:
          'In this video, we walk through the course roadmap: what each module covers, how assessments work, and where to find help if you get stuck along the way.',
      },
    ],
  },
  {
    moduleId: 'm2',
    title: 'Core concepts',
    lessons: [
      {
        lessonId: 'l3',
        type: 'text',
        title: 'Key terminology',
        minutes: 5,
        paragraphs: [
          "Before going further, let's define a few terms you'll see throughout this course. Getting comfortable with this vocabulary now will make later lessons much easier to follow.",
          "We'll build on these definitions with worked examples in the next few lessons, so don't worry about memorising them yet — just get familiar with the general shape of each idea.",
        ],
      },
      {
        lessonId: 'l4',
        type: 'image',
        title: 'Visual overview',
        minutes: 3,
        emoji: '🗺',
        surface: 'from-emerald-500/20 to-teal-500/5',
        caption:
          'A map of how the core concepts in this module relate to one another.',
      },
      {
        lessonId: 'l5',
        type: 'video',
        title: 'Concept walkthrough',
        minutes: 8,
        surface: 'from-violet-500/20 to-fuchsia-500/5',
        transcript:
          'This walkthrough takes the terminology from the previous lesson and applies it to a realistic scenario, step by step, so you can see how the pieces fit together in practice.',
        attachments: [
          {
            name: 'Lecture slides.txt',
            kind: 'doc',
            sizeLabel: '5 KB',
            mimeType: 'text/plain',
            content:
              'Lecture slides — Concept walkthrough\n\nSlide 1: Recap of key terminology\nSlide 2: The scenario\nSlide 3: Step-by-step walkthrough\nSlide 4: Common mistakes to avoid\nSlide 5: Summary',
          },
          {
            name: 'Practice dataset.csv',
            kind: 'csv',
            sizeLabel: '1 KB',
            mimeType: 'text/csv',
            content:
              'id,label,value\n1,sample a,12\n2,sample b,27\n3,sample c,9\n4,sample d,34',
          },
        ],
      },
      {
        lessonId: 'l6',
        type: 'quiz',
        title: 'Check your understanding',
        minutes: 3,
        dueDate: 'Sep 30, 2026, 11:59 PM',
        attemptsAllowed: 2,
        question:
          'Which of the following best matches this course’s central concept?',
        options: [
          'A structured, repeatable process for approaching problems',
          'A single fact that never changes',
          'A tool only used in advanced coursework',
          'None of the above',
        ],
        correctIndex: 0,
      },
    ],
  },
  {
    moduleId: 'm3',
    title: 'Applying your skills',
    lessons: [
      {
        lessonId: 'l7',
        type: 'text',
        title: 'Worked example',
        minutes: 6,
        paragraphs: [
          "Let's put everything together with a full worked example, from framing the problem through to checking the result.",
          'Try pausing after each step to predict what comes next — it’s the fastest way to tell whether a concept has really clicked.',
        ],
        attachments: [
          {
            name: 'Practice worksheet.txt',
            kind: 'doc',
            sizeLabel: '3 KB',
            mimeType: 'text/plain',
            content:
              'Practice worksheet\n\nWork through the following on your own, then compare your approach with the worked example:\n\n1. Frame the problem in your own words.\n2. List the steps you would take to solve it.\n3. Identify how you would check your result.',
          },
        ],
      },
      {
        lessonId: 'l8',
        type: 'quiz',
        title: 'Module 3 quiz',
        minutes: 4,
        dueDate: 'Oct 7, 2026, 11:59 PM',
        attemptsAllowed: 3,
        question:
          'What should you do if a step in the worked example doesn’t make sense?',
        options: [
          'Skip ahead and hope it becomes clear later',
          'Re-read the relevant lesson or ask for help before continuing',
          'Guess and move on',
          'Restart the entire course',
        ],
        correctIndex: 1,
      },
    ],
  },
];

const allLessons = modules.flatMap((module) =>
  module.lessons.map((lesson) => ({ ...lesson, moduleId: module.moduleId })),
);

// Mirrors the enrolled-course titles in the dashboard's "Continue learning"
// mock list, keyed by course code, so this page shows a real course title
// rather than the code when navigated to from there.
const MOCK_COURSE_TITLES: Record<string, string> = {
  BIO102: 'Foundations of Biology',
  MTH201: 'Applied Mathematics',
  COM105: 'Academic Communication',
  DAT110: 'Data Literacy',
  PSY101: 'Introduction to Psychology',
};

const lessonTypeMeta: Record<
  Lesson['type'],
  { label: string; icon: typeof FileText }
> = {
  text: { label: 'Reading', icon: FileText },
  image: { label: 'Visual', icon: ImageIcon },
  video: { label: 'Video', icon: Play },
  quiz: { label: 'Quiz', icon: ListChecks },
};

const attachmentIcons: Record<Attachment['kind'], typeof FileText> = {
  doc: FileText,
  csv: FileSpreadsheet,
};

function downloadAttachment(attachment: Attachment) {
  const blob = new Blob([attachment.content], { type: attachment.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function LessonBody({
  lesson,
  quizAnswer,
  onSelectOption,
  quizStarted,
  onStartQuiz,
  attemptsUsed,
  onRetakeQuiz,
}: {
  lesson: Lesson;
  quizAnswer?: { selected: number; submitted: boolean };
  onSelectOption: (optionIndex: number) => void;
  quizStarted: boolean;
  onStartQuiz: () => void;
  attemptsUsed: number;
  onRetakeQuiz: () => void;
}) {
  switch (lesson.type) {
    case 'text':
      return (
        <div className="space-y-4">
          {lesson.paragraphs.map((paragraph) => (
            <p key={paragraph} className="leading-7 text-foreground">
              {paragraph}
            </p>
          ))}
        </div>
      );
    case 'image':
      return (
        <figure>
          <div
            className={`flex h-56 items-center justify-center rounded-xl bg-gradient-to-br sm:h-72 ${lesson.surface}`}
          >
            <span aria-hidden="true" className="text-6xl">
              {lesson.emoji}
            </span>
          </div>
          <figcaption className="mt-3 text-sm text-muted-foreground">
            {lesson.caption}
          </figcaption>
        </figure>
      );
    case 'video':
      return (
        <div>
          <div
            className={`relative flex h-56 items-center justify-center rounded-xl bg-gradient-to-br sm:h-80 ${lesson.surface}`}
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-background/90 shadow-sm">
              <Play className="ml-0.5 size-6 fill-foreground text-foreground" />
            </span>
            <Badge
              variant="secondary"
              className="absolute right-3 top-3 bg-background/90"
            >
              {lesson.minutes} min
            </Badge>
          </div>
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Transcript</h3>
            <p className="mt-1.5 leading-7 text-muted-foreground">
              {lesson.transcript}
            </p>
          </div>
        </div>
      );
    case 'quiz': {
      const attemptsRemaining = lesson.attemptsAllowed - attemptsUsed;

      if (!quizStarted) {
        return (
          <Card className="border-primary/20">
            <CardContent className="space-y-5">
              <div>
                <p className="text-lg font-semibold">{lesson.title}</p>
                <p className="text-sm text-muted-foreground">1 question</p>
              </div>
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="size-4" /> Due date
                  </dt>
                  <dd className="font-medium">{lesson.dueDate}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <RotateCcw className="size-4" /> Attempts
                  </dt>
                  <dd className="font-medium">
                    {attemptsUsed} of {lesson.attemptsAllowed} used
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock3 className="size-4" /> Time
                  </dt>
                  <dd className="font-medium">{lesson.minutes} min</dd>
                </div>
              </dl>
              <Button
                className="w-full"
                disabled={attemptsRemaining <= 0}
                onClick={onStartQuiz}
              >
                {attemptsRemaining <= 0
                  ? 'No attempts remaining'
                  : attemptsUsed > 0
                    ? 'Retake quiz'
                    : 'Start quiz'}
              </Button>
            </CardContent>
          </Card>
        );
      }

      const selected = quizAnswer?.selected;
      const submitted = quizAnswer?.submitted ?? false;
      const isCorrect = submitted && selected === lesson.correctIndex;
      return (
        <Card className="border-primary/20">
          <CardContent className="space-y-4">
            <p className="font-medium">{lesson.question}</p>
            <RadioGroup
              className="gap-2"
              value={selected === undefined ? '' : String(selected)}
              onValueChange={(value) => onSelectOption(Number(value))}
              disabled={submitted}
              aria-label={lesson.question}
            >
              {lesson.options.map((option, optionIndex) => {
                const id = `${lesson.lessonId}-option-${optionIndex}`;
                const isSelected = selected === optionIndex;
                const isRightAnswer = optionIndex === lesson.correctIndex;
                const showCorrectness = submitted && isSelected;
                return (
                  <Label
                    key={option}
                    htmlFor={id}
                    className={`cursor-pointer gap-3 rounded-lg border px-3.5 py-2.5 font-normal leading-normal transition-colors ${submitted ? 'cursor-not-allowed' : ''} ${
                      showCorrectness && isRightAnswer
                        ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30'
                        : showCorrectness
                          ? 'border-red-500/50 bg-red-50 dark:bg-red-950/30'
                          : isSelected
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem id={id} value={String(optionIndex)} />
                    {option}
                  </Label>
                );
              })}
            </RadioGroup>
            {submitted ? (
              <div
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium ${
                  isCorrect
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                }`}
              >
                {isCorrect ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <AlertCircle className="size-4 shrink-0" />
                )}
                {isCorrect
                  ? 'Correct!'
                  : `Not quite — the correct answer is "${lesson.options[lesson.correctIndex]}".`}
              </div>
            ) : null}
            {submitted && attemptsRemaining > 0 && (
              <Button variant="outline" onClick={onRetakeQuiz}>
                <RotateCcw className="size-4" /> Back to quiz overview
              </Button>
            )}
            {!submitted && (
              <Button
                disabled={selected === undefined}
                onClick={() => onSelectOption(selected ?? 0)}
              >
                Check answer
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }
  }
}

export function CourseContent({ courseCode }: { courseCode: string }) {
  // A real course (reached from its preview's Continue button) shows its own
  // title over the mock lessons until the player uses real content (#148
  // item 7); the dashboard's mock courses keep their mock titles.
  const trpc = useCoreApi();
  const mockTitle = MOCK_COURSE_TITLES[courseCode];
  const realCourse = useQuery(
    trpc.course.publicView.queryOptions(
      { courseId: courseCode },
      { enabled: !mockTitle },
    ),
  );
  const course = toDisplayCourse({
    courseId: courseCode,
    title: mockTitle ?? realCourse.data?.title ?? '',
  });
  const [activeLessonId, setActiveLessonId] = useState(allLessons[0].lessonId);
  const [expandedModuleIds, setExpandedModuleIds] = useState<Set<string>>(
    new Set([modules[0].moduleId]),
  );
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(
    new Set(),
  );
  const [quizAnswers, setQuizAnswers] = useState<
    Record<string, { selected: number; submitted: boolean }>
  >({});
  const [startedQuizIds, setStartedQuizIds] = useState<Set<string>>(new Set());
  const [quizAttempts, setQuizAttempts] = useState<Record<string, number>>({});

  const activeIndex = allLessons.findIndex(
    (lesson) => lesson.lessonId === activeLessonId,
  );
  const activeLesson = allLessons[activeIndex];
  const totalLessons = allLessons.length;

  function goToLesson(lessonId: string) {
    const lesson = allLessons.find((item) => item.lessonId === lessonId);
    if (!lesson) return;
    setActiveLessonId(lessonId);
    setExpandedModuleIds((current) => {
      if (current.has(lesson.moduleId)) return current;
      return new Set(current).add(lesson.moduleId);
    });
  }

  function toggleModuleExpanded(moduleId: string) {
    setExpandedModuleIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }

  function toggleComplete(lessonId: string) {
    setCompletedLessonIds((current) => {
      const next = new Set(current);
      if (next.has(lessonId)) {
        next.delete(lessonId);
      } else {
        next.add(lessonId);
      }
      return next;
    });
  }

  function startQuiz(lessonId: string) {
    setStartedQuizIds((current) => new Set(current).add(lessonId));
  }

  function retakeQuiz(lessonId: string) {
    setStartedQuizIds((current) => {
      const next = new Set(current);
      next.delete(lessonId);
      return next;
    });
    setQuizAnswers((current) => {
      const { [lessonId]: _removed, ...rest } = current;
      return rest;
    });
  }

  function selectQuizOption(lessonId: string, optionIndex: number) {
    const existing = quizAnswers[lessonId];
    if (existing?.submitted) return;

    if (existing && existing.selected === optionIndex) {
      setQuizAnswers((current) => ({
        ...current,
        [lessonId]: { selected: optionIndex, submitted: true },
      }));
      setQuizAttempts((current) => ({
        ...current,
        [lessonId]: (current[lessonId] ?? 0) + 1,
      }));
      setCompletedLessonIds((current) => new Set(current).add(lessonId));
      return;
    }

    setQuizAnswers((current) => ({
      ...current,
      [lessonId]: { selected: optionIndex, submitted: false },
    }));
  }

  const TypeIcon = lessonTypeMeta[activeLesson.type].icon;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-8">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Home
      </Link>

      <div className="mt-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {course.title}
        </h1>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.6fr]">
        <section
          aria-labelledby="content-nav-heading"
          className="space-y-3 lg:sticky lg:top-20 lg:h-fit"
        >
          <h2 id="content-nav-heading" className="sr-only">
            Course content
          </h2>
          {modules.map((module, moduleIndex) => {
            const isExpanded = expandedModuleIds.has(module.moduleId);
            const completedInModule = module.lessons.filter((lesson) =>
              completedLessonIds.has(lesson.lessonId),
            ).length;
            return (
              <Collapsible
                key={module.moduleId}
                asChild
                open={isExpanded}
                onOpenChange={() => toggleModuleExpanded(module.moduleId)}
              >
                <Card className="gap-0 overflow-hidden py-0">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                        {moduleIndex + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {module.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {completedInModule}/{module.lessons.length} complete
                        </span>
                      </span>
                      <ChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent asChild>
                    <CardContent className="border-t p-0">
                      {module.lessons.map((lesson) => {
                        const LessonIcon = lessonTypeMeta[lesson.type].icon;
                        const isActive = lesson.lessonId === activeLessonId;
                        const isComplete = completedLessonIds.has(
                          lesson.lessonId,
                        );
                        return (
                          <button
                            key={lesson.lessonId}
                            type="button"
                            onClick={() => goToLesson(lesson.lessonId)}
                            aria-current={isActive}
                            className={`flex w-full items-center gap-3 border-b px-4 py-2.5 text-left last:border-b-0 sm:pl-5 sm:pr-4 ${isActive ? 'bg-primary/5' : 'hover:bg-muted/40'}`}
                          >
                            {isComplete ? (
                              <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <LessonIcon className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <span
                              className={`flex-1 truncate text-sm ${isActive ? 'font-medium text-foreground' : 'text-foreground/90'}`}
                            >
                              {lesson.title}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {lesson.minutes} min
                            </span>
                          </button>
                        );
                      })}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </section>

        <section aria-labelledby="lesson-heading" className="min-w-0 space-y-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <TypeIcon className="size-3.5" />
              {lessonTypeMeta[activeLesson.type].label}
              <span aria-hidden="true">&middot;</span>
              <Clock3 className="size-3.5" />
              {activeLesson.minutes} min
            </div>
            <h2 id="lesson-heading" className="mt-1 text-xl font-semibold">
              {activeLesson.title}
            </h2>
          </div>

          <LessonBody
            lesson={activeLesson}
            quizAnswer={quizAnswers[activeLesson.lessonId]}
            onSelectOption={(optionIndex) =>
              selectQuizOption(activeLesson.lessonId, optionIndex)
            }
            quizStarted={startedQuizIds.has(activeLesson.lessonId)}
            onStartQuiz={() => startQuiz(activeLesson.lessonId)}
            attemptsUsed={quizAttempts[activeLesson.lessonId] ?? 0}
            onRetakeQuiz={() => retakeQuiz(activeLesson.lessonId)}
          />

          {activeLesson.attachments && activeLesson.attachments.length > 0 && (
            <Card className="gap-0 overflow-hidden py-0">
              <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5 text-sm font-medium">
                <Paperclip className="size-4 text-muted-foreground" />
                Attachments
              </div>
              <CardContent className="divide-y p-0">
                {activeLesson.attachments.map((attachment) => {
                  const AttachmentIcon = attachmentIcons[attachment.kind];
                  return (
                    <div
                      key={attachment.name}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <AttachmentIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {attachment.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {attachment.sizeLabel}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadAttachment(attachment)}
                      >
                        <Download className="size-4" /> Download
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {activeLesson.type === 'quiz' ? (
            completedLessonIds.has(activeLesson.lessonId) && (
              <div className="flex justify-end">
                <Badge
                  variant="secondary"
                  className="border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                >
                  <CircleCheck className="size-4" /> Completed
                </Badge>
              </div>
            )
          ) : (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => toggleComplete(activeLesson.lessonId)}
                className={
                  completedLessonIds.has(activeLesson.lessonId)
                    ? 'border-emerald-500/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : undefined
                }
              >
                <CircleCheck className="size-4" />
                {completedLessonIds.has(activeLesson.lessonId)
                  ? 'Completed'
                  : 'Mark as complete'}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Button
              variant="outline"
              disabled={activeIndex === 0}
              onClick={() =>
                goToLesson(allLessons[Math.max(activeIndex - 1, 0)].lessonId)
              }
            >
              <ArrowLeft className="size-4" /> Previous
            </Button>
            <Button
              disabled={activeIndex === totalLessons - 1}
              onClick={() =>
                goToLesson(
                  allLessons[Math.min(activeIndex + 1, totalLessons - 1)]
                    .lessonId,
                )
              }
            >
              Next <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </div>

      <div className="mt-8 flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <GraduationCap className="size-4" /> Prototype content shown for design
        feedback; lesson content is illustrative and progress isn't saved.
      </div>
    </main>
  );
}
