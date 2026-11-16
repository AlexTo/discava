/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A video's caption tracks live on its contentItem (captionTracks, with
// captionTracksRev as the condition that serialises writers). Every writer --
// Transcribe's completion, an instructor's upload or removal, the version
// swap -- computes the new list here, so the rules hold wherever it's written.

/** Most tracks a video can have. */
export const MAX_CAPTION_TRACKS = 10;

export interface CaptionTrack {
  trackId: string;
  // The version (manifest nonce) the track belongs to.
  nonce: string;
  // BCP 47 tag from the shared caption languages.
  language: string;
  label: string;
  source: 'auto' | 'uploaded';
  // S3 key in the lesson media bucket.
  key: string;
  isDefault: boolean;
}

export type CaptionChange =
  | { type: 'add'; nonce: string; track: Omit<CaptionTrack, 'isDefault'> }
  | { type: 'remove'; nonce: string; trackId: string };

export type CaptionTrackErrorCode = 'TOO_MANY_TRACKS' | 'STALE_VERSION';

export class CaptionTrackError extends Error {
  constructor(
    readonly code: CaptionTrackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaptionTrackError';
  }
}

export interface CaptionChangeResult {
  tracks: CaptionTrack[];
  // The track an add replaced, so its file can be deleted.
  replaced?: CaptionTrack;
  // The track a remove took out, so its file can be deleted.
  removed?: CaptionTrack;
  // An auto add that was not applied because an uploaded track already holds
  // the language: a late Transcribe result never overwrites an instructor's
  // upload. The caller logs it and still treats captioning as done.
  dropped?: true;
}

/**
 * The tracks after a change, as a new list. `currentNonce` is the nonce of the
 * item's current ready version: a change for any other version is refused with
 * STALE_VERSION.
 */
export const applyCaptionChange = (
  current: readonly CaptionTrack[] | undefined,
  change: CaptionChange,
  { currentNonce }: { currentNonce: string | undefined },
): CaptionChangeResult => {
  if (currentNonce === undefined || change.nonce !== currentNonce) {
    throw new CaptionTrackError('STALE_VERSION', 'The video changed');
  }
  const tracks = [...(current ?? [])];

  if (change.type === 'remove') {
    const index = tracks.findIndex((t) => t.trackId === change.trackId);
    if (index === -1) {
      return { tracks };
    }
    const [removed] = tracks.splice(index, 1);
    if (removed.isDefault) {
      const oldest = tracks.find((t) => t.nonce === change.nonce);
      if (oldest) {
        tracks[tracks.indexOf(oldest)] = { ...oldest, isDefault: true };
      }
    }
    return { tracks, removed };
  }

  const added = change.track;
  const sameLanguage = tracks.findIndex(
    (t) => t.nonce === change.nonce && t.language === added.language,
  );

  if (sameLanguage !== -1) {
    const replaced = tracks[sameLanguage];
    if (added.source === 'auto' && replaced.source === 'uploaded') {
      return { tracks, dropped: true };
    }
    tracks[sameLanguage] = { ...added, isDefault: replaced.isDefault };
    return { tracks, replaced };
  }

  if (tracks.length >= MAX_CAPTION_TRACKS) {
    throw new CaptionTrackError(
      'TOO_MANY_TRACKS',
      `A video can have at most ${MAX_CAPTION_TRACKS} caption tracks`,
    );
  }
  const hasDefault = tracks.some(
    (t) => t.nonce === change.nonce && t.isDefault,
  );
  if (added.source === 'auto') {
    // The auto track is the default whenever it exists.
    return {
      tracks: [
        ...tracks.map((t) =>
          t.nonce === change.nonce ? { ...t, isDefault: false } : t,
        ),
        { ...added, isDefault: true },
      ],
    };
  }
  return { tracks: [...tracks, { ...added, isDefault: !hasDefault }] };
};

/** The tracks of one version only: the version swap drops all the others. */
export const dropOtherVersions = (
  current: readonly CaptionTrack[] | undefined,
  nonce: string,
): CaptionTrack[] => (current ?? []).filter((t) => t.nonce === nonce);

/**
 * The tracks to offer for the version being played: only that version's, the
 * default first, the rest in the order they were added.
 */
export const tracksForPlayback = (
  current: readonly CaptionTrack[] | undefined,
  nonce: string,
): CaptionTrack[] => {
  const tracks = dropOtherVersions(current, nonce);
  return [
    ...tracks.filter((t) => t.isDefault),
    ...tracks.filter((t) => !t.isDefault),
  ];
};

/**
 * A video's automatic captioning status as an API reports it: a pending
 * status older than this is reported as failed, since the job is not coming
 * back (research R-11).
 */
export const CAPTIONS_PENDING_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const reportedCaptionsStatus = (
  item: { captionsStatus?: string; captionsPendingSince?: string },
  now: Date = new Date(),
): 'pending' | 'ready' | 'failed' | undefined => {
  const status = item.captionsStatus;
  if (status !== 'pending' && status !== 'ready' && status !== 'failed') {
    return undefined;
  }
  if (
    status === 'pending' &&
    (!item.captionsPendingSince ||
      now.getTime() - new Date(item.captionsPendingSince).getTime() >
        CAPTIONS_PENDING_TIMEOUT_MS)
  ) {
    return 'failed';
  }
  return status;
};

// The shape of ElectroDB's where() callback arguments, as much as this needs.
interface ConditionOps<Expression> {
  eq(attribute: unknown, value: unknown): Expression;
  and(...expressions: Expression[]): Expression;
  or(...expressions: Expression[]): Expression;
  notExists(attribute: unknown): Expression;
  contains(attribute: unknown, value: unknown): Expression;
}
interface ConditionAttributes {
  captionTracksRev: unknown;
  status: unknown;
  s3Key: unknown;
}

/**
 * The `.where()` condition for a conditional write of captionTracks: the
 * revision is still the one that was read (an absent one counts as 0) and the
 * item's ready video is still the version the change is for, whose manifest
 * lives under `/<nonce>/`. A lost race fails the write (see
 * isConditionalCheckFailed).
 */
export const captionWriteCondition =
  (rev: number, nonce: string) =>
  <Expression>(attr: ConditionAttributes, op: ConditionOps<Expression>) => {
    const revision = op.eq(attr.captionTracksRev, rev);
    return op.and(
      rev === 0
        ? op.or(op.notExists(attr.captionTracksRev), revision)
        : revision,
      op.eq(attr.status, 'ready'),
      op.contains(attr.s3Key, `/${nonce}/`),
    );
  };
