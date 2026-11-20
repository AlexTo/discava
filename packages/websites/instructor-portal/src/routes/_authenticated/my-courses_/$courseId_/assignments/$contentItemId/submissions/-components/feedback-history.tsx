/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RichTextView } from '@discava/common-shadcn/components/rich-text-view';

export interface FeedbackRound {
  feedbackId: string;
  kind: 'resubmission_requested' | 'returned' | 'amended';
  feedback?: string;
  points?: number;
  pointsOutOf?: number;
  version: number;
  givenAt: string;
  givenBy: { userId: string; displayName: string };
}

const KIND_LABELS: Record<FeedbackRound['kind'], string> = {
  resubmission_requested: 'Resubmission requested',
  returned: 'Returned',
  amended: 'Grade updated',
};

// Earlier rounds of feedback on the student's work, newest first.
export function FeedbackHistory({ rounds }: { rounds: FeedbackRound[] }) {
  if (rounds.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3" aria-labelledby="feedback-history">
      <h2 id="feedback-history" className="text-lg font-semibold">
        Feedback history
      </h2>
      <ul className="space-y-4 border-l pl-4">
        {rounds.map((round) => (
          <li key={round.feedbackId} className="space-y-2">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{KIND_LABELS[round.kind]}</span>
              {round.points !== undefined && round.pointsOutOf !== undefined ? (
                <span className="font-medium">
                  {round.points} / {round.pointsOutOf}
                </span>
              ) : null}
              <span className="text-muted-foreground">
                Version {round.version}
              </span>
              <span className="text-muted-foreground">
                {new Date(round.givenAt).toLocaleString()}
              </span>
              <span className="text-muted-foreground">
                by {round.givenBy.displayName}
              </span>
            </p>
            {round.feedback ? <RichTextView value={round.feedback} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
