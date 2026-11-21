/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type PlayerCue,
  toCues,
  type VideoAnswer,
  type VideoQuestion,
} from '@discava/common-web-utils/video-questions';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '../components/ui/button';
import { VideoQuestionCard } from '../components/video-question-card';

// Why recording an answer didn't work: the question was edited meanwhile
// (`updated`), or removed (`removed`), or the save failed (`failed`).
export interface VideoAnswerFailure {
  kind: 'updated' | 'removed' | 'failed';
}

const isFailure = (error: unknown): error is VideoAnswerFailure =>
  typeof error === 'object' &&
  error !== null &&
  'kind' in error &&
  ['updated', 'removed', 'failed'].includes((error as { kind: string }).kind);

// How many of the end questions answered so far were right.
function EndSummary({
  correct,
  total,
  onClose,
}: {
  correct: number;
  total: number;
  onClose: () => void;
}) {
  const heading = (node: HTMLHeadingElement | null) => node?.focus();
  return (
    <div
      data-slot="video-question-summary"
      className="mx-auto my-3 w-[calc(100%-1.5rem)] max-w-2xl min-w-0 space-y-4 rounded-lg bg-background p-4 text-foreground shadow-lg"
    >
      <h2
        ref={heading}
        data-autofocus
        tabIndex={-1}
        className="text-base font-medium outline-none"
      >
        {correct} of {total} correct
      </h2>
      <Button type="button" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

/**
 * Holds which video question is open and in which state, and turns the
 * player's `onCue` calls into the overlay it shows. It is given the
 * questions, the caller's answers and one function that records an answer,
 * so every portal shares it.
 *
 * Cues reached together are asked one after another before the overlay
 * clears. A skipped question is left alone for the life of the component: it
 * isn't asked again as playback reaches it, though its marker still opens it.
 * An end check asks its questions in order, then shows how many were right.
 */
export function useVideoQuestions({
  questions,
  answers,
  submit,
  onChanged,
}: {
  questions: VideoQuestion[];
  answers: Record<string, VideoAnswer>;
  // Records an answer and resolves with the result, or rejects with a
  // `VideoAnswerFailure`.
  submit: (
    question: VideoQuestion,
    optionIds: string[],
  ) => Promise<VideoAnswer>;
  // Refetch the questions after `updated` or `removed`.
  onChanged?: () => void;
}): {
  cues: PlayerCue[];
  onCue: (cueIds: string[], reason: 'reached' | 'chosen' | 'ended') => void;
  overlay: ReactNode;
  onOverlayDismiss: () => void;
} {
  // The ids still to ask, the open one first, and how the run began.
  const [queue, setQueue] = useState<string[]>([]);
  const [run, setRun] = useState<{ total: number; end: boolean }>();
  const [summary, setSummary] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [updated, setUpdated] = useState(false);
  // Answers recorded here, until the caller's own catch up.
  const [recorded, setRecorded] = useState<Record<string, VideoAnswer>>({});
  const skipped = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const held = useMemo(
    () => ({ ...recorded, ...answers }),
    [recorded, answers],
  );
  const cues = useMemo(() => toCues(questions, held), [questions, held]);
  const open = queue.length > 0 || summary;

  const reset = () => {
    setPending(false);
    setError(undefined);
    setUpdated(false);
  };

  const clear = useCallback(() => {
    setQueue([]);
    setRun(undefined);
    setSummary(false);
    reset();
  }, []);

  const advance = () => {
    reset();
    if (queue.length > 1) {
      setQueue(queue.slice(1));
    } else if (run?.end && queue.length === 1) {
      setQueue([]);
      setSummary(true);
    } else {
      clear();
    }
  };

  const onCue = (cueIds: string[], reason: 'reached' | 'chosen' | 'ended') => {
    if (open) {
      return;
    }
    const known = new Set(questions.map((q) => q.questionId));
    const ids = cueIds.filter(
      (id) =>
        known.has(id) &&
        (reason === 'chosen' || (!held[id] && !skipped.current.has(id))),
    );
    if (ids.length === 0) {
      return;
    }
    reset();
    setQueue(ids);
    setRun({ total: ids.length, end: reason === 'ended' });
  };

  const question = questions.find((q) => q.questionId === queue[0]);
  // A question removed while it was open leaves nothing to show.
  useEffect(() => {
    if (queue.length > 0 && !question) {
      clear();
    }
  }, [queue.length, question, clear]);

  const record = async (target: VideoQuestion, optionIds: string[]) => {
    setPending(true);
    setError(undefined);
    try {
      const result = await submit(target, optionIds);
      if (!mounted.current) {
        return;
      }
      setRecorded((current) => ({ ...current, [target.questionId]: result }));
      setPending(false);
    } catch (failure) {
      if (!mounted.current) {
        return;
      }
      const kind = isFailure(failure) ? failure.kind : 'failed';
      if (kind === 'removed') {
        onChanged?.();
        clear();
      } else if (kind === 'updated') {
        setPending(false);
        setUpdated(true);
        onChanged?.();
      } else {
        setPending(false);
        setError(
          "Couldn't save your answer. Check your connection and try again.",
        );
      }
    }
  };

  const skip = () => {
    if (question) {
      skipped.current.add(question.questionId);
    }
    advance();
  };

  let overlay: ReactNode;
  if (summary && run) {
    const endAnswers = Object.keys(held).filter((id) =>
      questions.some((q) => q.questionId === id && q.atSeconds === null),
    );
    overlay = (
      <EndSummary
        correct={endAnswers.filter((id) => held[id]?.correct).length}
        total={endAnswers.length}
        onClose={clear}
      />
    );
  } else if (question && run) {
    overlay = (
      <VideoQuestionCard
        key={question.questionId}
        question={question}
        position={
          run.end
            ? { number: run.total - queue.length + 1, total: run.total }
            : undefined
        }
        answer={held[question.questionId]}
        pending={pending}
        error={error}
        updated={updated}
        onSubmit={(optionIds) => record(question, optionIds)}
        onSkip={skip}
        onContinue={advance}
      />
    );
  }

  const onOverlayDismiss = () => {
    if (summary) {
      clear();
    } else if (question && held[question.questionId]) {
      advance();
    } else {
      skip();
    }
  };

  return { cues, onCue, overlay, onOverlayDismiss };
}
