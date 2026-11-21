/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { RichTextView } from '@discava/common-shadcn/components/rich-text-view';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@discava/common-shadcn/components/ui/collapsible';

// One instructor action on the student's submission, as core-api returns it
// (`assignment.mySubmission`'s `feedback`).
export type FeedbackRound = {
  kind: 'resubmission_requested' | 'returned' | 'amended';
  feedback?: string;
  points?: number;
  pointsOutOf?: number;
  version: number;
  givenAt: string;
};

const KIND_LABELS: Record<FeedbackRound['kind'], string> = {
  resubmission_requested: 'Resubmission requested',
  returned: 'Returned',
  amended: 'Grade updated',
};

// One round: what the instructor did, when, on which version, the points and
// the feedback.
export function AssignmentFeedbackRound({ round }: { round: FeedbackRound }) {
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{KIND_LABELS[round.kind]}</span>
        {round.points !== undefined && round.pointsOutOf !== undefined ? (
          <span className="font-medium">
            {round.points} / {round.pointsOutOf}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {new Date(round.givenAt).toLocaleString()}
        </span>
        <span className="text-muted-foreground">Version {round.version}</span>
      </p>
      {round.feedback ? <RichTextView value={round.feedback} /> : null}
    </div>
  );
}

// Earlier rounds of feedback, collapsed by default; `rounds` is newest first.
export function AssignmentFeedback({ rounds }: { rounds: FeedbackRound[] }) {
  if (rounds.length === 0) {
    return null;
  }
  return (
    <Collapsible className="space-y-3">
      <CollapsibleTrigger className="text-sm font-medium underline-offset-4 hover:underline">
        Earlier feedback ({rounds.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-4 border-l pl-4">
          {rounds.map((round) => (
            <li key={`${round.givenAt}-${round.kind}`}>
              <AssignmentFeedbackRound round={round} />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
