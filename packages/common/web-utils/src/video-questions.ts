/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { QuizQuestion } from './quiz.js';

// Questions asked inside a video: the pure logic of when the player asks them
// and how an answer is judged. The shape matches core-api's
// videoQuestion.view without depending on it.

export interface VideoQuestion extends QuizQuestion {
  // Whole seconds into the video, or null for a question asked at the end.
  atSeconds: number | null;
  contentHash: string;
}

export interface VideoAnswer {
  optionIds: string[];
  correct: boolean;
  correctOptionIds: string[];
  // Tiptap JSON.
  explanation?: string;
}

export type CueState = 'unanswered' | 'answered';

export interface PlayerCue {
  // The questionId.
  id: string;
  // null: at the end.
  atSeconds: number | null;
  state: CueState;
  // "Question at 1:30, not answered"
  label: string;
}

// Between two time updates of normal playback the video moves by well under
// this. A bigger step is a seek the events missed, which reaches nothing.
export const MAX_PLAYBACK_STEP_SECONDS = 2;

const clock = (seconds: number) => {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// Cues in asking order: by time, then list order, then the end ones.
export const toCues = (
  questions: VideoQuestion[],
  answers: Record<string, VideoAnswer>,
): PlayerCue[] =>
  questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => {
      const at = a.question.atSeconds;
      const bt = b.question.atSeconds;
      if (at === bt) {
        return a.index - b.index;
      }
      if (at === null) {
        return 1;
      }
      if (bt === null) {
        return -1;
      }
      return at - bt;
    })
    .map(({ question: { questionId, atSeconds } }) => {
      const state: CueState = answers[questionId] ? 'answered' : 'unanswered';
      return {
        id: questionId,
        atSeconds,
        state,
        label: `Question ${
          atSeconds === null ? 'at the end' : `at ${clock(atSeconds)}`
        }, ${state === 'answered' ? 'answered' : 'not answered'}`,
      };
    });

// Where a cue sits on a video of this length: null (the end) when it has no
// time or its time is at or past the duration.
export const cueTime = (
  cue: PlayerCue,
  durationSeconds: number,
): number | null =>
  cue.atSeconds === null || cue.atSeconds >= durationSeconds
    ? null
    : cue.atSeconds;

// The timed cues playback passed going from `previous` to `current`, in
// order. Empty when it moved backwards or by more than
// MAX_PLAYBACK_STEP_SECONDS. A cue at 0 is reached by the first step forward
// from 0.
export const cuesReached = (
  cues: PlayerCue[],
  previous: number,
  current: number,
  durationSeconds: number,
): PlayerCue[] => {
  if (current <= previous || current - previous > MAX_PLAYBACK_STEP_SECONDS) {
    return [];
  }
  return cues.filter((cue) => {
    const at = cueTime(cue, durationSeconds);
    return (
      at !== null &&
      ((at > previous && at <= current) || (at === 0 && previous === 0))
    );
  });
};

// The cues to ask when the video ends: end cues, and timed ones at or past
// the duration.
export const cuesAtEnd = (
  cues: PlayerCue[],
  durationSeconds: number,
): PlayerCue[] => cues.filter((cue) => cueTime(cue, durationSeconds) === null);

// The position to save while a cue is open: one second before it, never
// below 0. An end cue counts as the end of the video.
export const positionBeforeCue = (
  cue: PlayerCue,
  currentTime: number,
  durationSeconds: number,
): number => {
  const at =
    cueTime(cue, durationSeconds) ??
    (Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : currentTime);
  return Math.max(0, Math.floor(at) - 1);
};

// All-or-nothing, as core-api grades: the chosen options are exactly the
// correct ones.
export const isCorrectAnswer = (
  optionIds: string[],
  correctOptionIds: string[],
): boolean => {
  const correct = new Set(correctOptionIds);
  const chosen = new Set(optionIds);
  return (
    chosen.size === correct.size && [...chosen].every((id) => correct.has(id))
  );
};
