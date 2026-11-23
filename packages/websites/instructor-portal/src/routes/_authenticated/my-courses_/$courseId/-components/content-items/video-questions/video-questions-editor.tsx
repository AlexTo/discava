/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import {
  HlsVideo,
  type PlayerCaption,
} from '@discava/common-shadcn/components/hls-video';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Switch } from '@discava/common-shadcn/components/ui/switch';
import { toCues } from '@discava/common-web-utils/video-questions';
import { CirclePlus, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QuestionCard } from '../quiz/question-card';
import {
  moveButtonId,
  questionElementId,
  useVideoQuestionsEditor,
} from './use-video-questions-editor';
import {
  canMove,
  formatTime,
  isAfterEnd,
  MAX_VIDEO_QUESTIONS,
  parseTime,
  type VideoItem,
  type VideoQuestionState,
} from './video-questions-form';
import { VideoQuestionsPreview } from './video-questions-preview';

// The time a question is asked at, as `m:ss` text. What's typed is applied
// when the field is left or Enter is pressed, so a card doesn't jump while
// the instructor is still typing; text that isn't a time marks the card.
function AskAtFields({
  question,
  number,
  readOnly,
  onChange,
}: {
  question: VideoQuestionState;
  number: number;
  readOnly: boolean;
  onChange: (atSeconds: number | null) => void;
}) {
  const atEnd = question.atSeconds === null;
  const shown =
    atEnd || Number.isNaN(question.atSeconds)
      ? ''
      : formatTime(question.atSeconds as number);
  const [draft, setDraft] = useState<string>();
  const apply = () => {
    if (draft === undefined) {
      return;
    }
    const seconds = parseTime(draft);
    onChange(seconds === undefined ? Number.NaN : seconds);
    setDraft(undefined);
  };
  const switchId = `${questionElementId(question.questionId)}-end`;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Label htmlFor={`${switchId}-time`}>Ask at</Label>
        <Input
          id={`${switchId}-time`}
          aria-label={`Ask at, question ${number}`}
          className="w-24"
          placeholder="m:ss"
          inputMode="numeric"
          disabled={readOnly || atEnd}
          value={draft ?? shown}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={atEnd}
          disabled={readOnly}
          aria-label={`At the end, question ${number}`}
          onCheckedChange={(checked) => onChange(checked ? null : 0)}
        />
        <Label htmlFor={switchId}>At the end</Label>
      </div>
    </div>
  );
}

// Adds, edits, moves and removes a video's questions, with the video beside
// them to take the time from. The whole list is saved together.
export function VideoQuestionsEditor({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  video,
  player,
  durationSeconds,
  studentActivityCount = 0,
  readOnlyReason,
  onDirtyChange,
  onReload,
  onClose,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  video: VideoItem;
  // The video to play; absent while it loads or can't be played.
  player?: {
    url: string;
    withCredentials: boolean;
    captions?: PlayerCaption[];
  };
  durationSeconds?: number;
  // Learners who have used the video, for the note about editing it.
  studentActivityCount?: number;
  // Why the questions can't be edited, or nothing if they can.
  readOnlyReason?: string;
  onDirtyChange?: (dirty: boolean) => void;
  // Fetches the questions again, after a CONFLICT.
  onReload: () => void;
  onClose: () => void;
}) {
  const readOnly = Boolean(readOnlyReason);
  const state = useVideoQuestionsEditor({
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    video,
    readOnly,
    onDirtyChange,
  });
  const { questions, errors, showProblems } = state;
  const problemCount = Object.keys(errors.questions).length;
  const [previewing, setPreviewing] = useState(false);
  // A marker for each question on the editor's own player; choosing one
  // scrolls to its card.
  const cues = useMemo(
    () =>
      toCues(
        questions
          .filter((question) => !Number.isNaN(question.atSeconds))
          .map((question) => ({
            questionId: question.questionId,
            kind: question.kind,
            prompt: question.prompt,
            options: question.options,
            atSeconds: question.atSeconds,
            contentHash: '',
          })),
        {},
      ),
    [questions],
  );
  const limitReason = `A video can have at most ${MAX_VIDEO_QUESTIONS} questions.`;

  return (
    <div className="space-y-6">
      {readOnlyReason && (
        <ErrorAlert header="These questions can't be edited">
          {readOnlyReason}
        </ErrorAlert>
      )}
      {!readOnly && studentActivityCount > 0 && (
        <ErrorAlert header="Learners have used this video">
          {studentActivityCount === 1
            ? '1 learner has'
            : `${studentActivityCount} learners have`}{' '}
          used this video. Answers already recorded are kept and aren't
          regraded.
        </ErrorAlert>
      )}

      {player && (
        <div className="space-y-3">
          <HlsVideo
            url={player.url}
            withCredentials={player.withCredentials}
            captions={player.captions}
            className="w-full rounded-lg border"
            onTimeChange={state.setCurrentTime}
            cues={cues}
            onCue={(ids, reason) => {
              if (reason === 'chosen') {
                state.jumpTo(ids[0]);
              }
            }}
          />
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                Current time {formatTime(state.currentTime)}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={state.atLimit}
                onClick={state.addHere}
              >
                <CirclePlus /> Add a question here
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={state.atLimit}
                onClick={state.addAtEnd}
              >
                <CirclePlus /> Add an end question
              </Button>
              {state.atLimit && (
                <span className="text-sm text-muted-foreground">
                  {limitReason}
                </span>
              )}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            aria-pressed={previewing}
            onClick={() => setPreviewing(!previewing)}
          >
            {previewing ? 'Stop previewing' : 'Preview as student'}
          </Button>
          {previewing && (
            <section aria-label="Student preview" className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Answers are checked here and aren't recorded.
              </p>
              <VideoQuestionsPreview
                url={player.url}
                withCredentials={player.withCredentials}
                captions={player.captions}
                questions={questions}
                className="w-full rounded-lg border"
              />
            </section>
          )}
        </div>
      )}

      <section aria-labelledby="video-questions-heading" className="space-y-3">
        <h2 id="video-questions-heading" className="text-lg font-semibold">
          Questions ({questions.length})
        </h2>
        {questions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No questions yet. Play the video to a moment and add one there, or
            add one for the end.
          </p>
        )}
        <ol className="space-y-3">
          {questions.map((question, index) => (
            <li
              key={question.questionId}
              id={questionElementId(question.questionId)}
              className="min-w-0 scroll-mt-4 space-y-2"
            >
              <QuestionCard
                question={question}
                number={index + 1}
                expanded={state.expanded === question.questionId}
                onToggle={() => state.toggle(question.questionId)}
                onChange={(changed) =>
                  state.changeQuestion({
                    ...changed,
                    atSeconds: question.atSeconds,
                  })
                }
                onRemove={() => state.remove(question.questionId)}
                canRemove
                problems={
                  showProblems
                    ? (errors.questions[question.questionId] ?? [])
                    : []
                }
                readOnly={readOnly}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <AskAtFields
                  question={question}
                  number={index + 1}
                  readOnly={readOnly}
                  onChange={(atSeconds) =>
                    state.changeQuestion({ ...question, atSeconds })
                  }
                />
                {!readOnly && (
                  <div className="flex gap-1">
                    <Button
                      id={moveButtonId(question.questionId, 'up')}
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move question ${index + 1} up`}
                      disabled={!canMove(questions, question.questionId, 'up')}
                      onClick={() => state.move(question.questionId, 'up')}
                    >
                      Move up
                    </Button>
                    <Button
                      id={moveButtonId(question.questionId, 'down')}
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move question ${index + 1} down`}
                      disabled={
                        !canMove(questions, question.questionId, 'down')
                      }
                      onClick={() => state.move(question.questionId, 'down')}
                    >
                      Move down
                    </Button>
                  </div>
                )}
              </div>
              {durationSeconds !== undefined &&
                isAfterEnd(question, durationSeconds) && (
                  <p className="px-1 text-sm text-muted-foreground">
                    After the end of the video: asked with the end check
                  </p>
                )}
            </li>
          ))}
        </ol>
      </section>

      <div className="sticky bottom-0 space-y-3 border-t bg-background/95 py-4 backdrop-blur">
        {showProblems && errors.video.length > 0 && (
          <ErrorAlert type="error" header="Fix these before saving">
            <ul className="list-disc pl-5">
              {errors.video.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </ErrorAlert>
        )}
        {showProblems && problemCount > 0 && (
          <p role="alert" className="text-sm text-destructive">
            {problemCount === 1
              ? '1 question needs fixing'
              : `${problemCount} questions need fixing`}{' '}
            before the questions can be saved.
          </p>
        )}
        {state.saveError &&
          (state.saveError.data?.code === 'CONFLICT' ? (
            <ErrorAlert
              type="error"
              header="These questions changed since you opened them"
            >
              <p>
                Someone saved them in the meantime. Reload to get the latest
                questions; your unsaved changes here will be lost.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={onReload}
              >
                Reload the questions
              </Button>
            </ErrorAlert>
          ) : (
            <ErrorAlert type="error" header="Couldn't save the questions">
              {state.saveError.message}
            </ErrorAlert>
          ))}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-muted-foreground" role="status">
            {state.justSaved ? 'Saved' : state.dirty ? 'Unsaved changes' : ''}
          </span>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {!readOnly && (
            <Button type="button" disabled={state.saving} onClick={state.save}>
              <Save /> {state.saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
