/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GradingDraftRef {
  courseId: string;
  contentItemId: string;
  userId: string;
}

// Points as typed (a string, so a half-typed "7." survives) and the feedback
// as the editor's Tiptap JSON.
export interface GradingDraft {
  points?: string;
  feedback?: string;
}

const draftKey = ({ courseId, contentItemId, userId }: GradingDraftRef) =>
  `discava:grading-draft:${courseId}:${contentItemId}:${userId}`;

// localStorage can be missing or throw (private mode, blocked storage): a
// draft is a convenience, so failing to read or write one is ignored.
export const readGradingDraft = (ref: GradingDraftRef): GradingDraft | null => {
  try {
    const raw = localStorage.getItem(draftKey(ref));
    return raw ? (JSON.parse(raw) as GradingDraft) : null;
  } catch {
    return null;
  }
};

export const writeGradingDraft = (
  ref: GradingDraftRef,
  draft: GradingDraft,
) => {
  try {
    localStorage.setItem(draftKey(ref), JSON.stringify(draft));
  } catch {}
};

export const clearGradingDraft = (ref: GradingDraftRef) => {
  try {
    localStorage.removeItem(draftKey(ref));
  } catch {}
};
