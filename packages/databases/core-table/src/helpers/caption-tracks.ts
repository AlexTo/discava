/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { createCoreTableService } from '../service.js';
import { isConditionalCheckFailed } from './errors.js';

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
  source: 'auto' | 'uploaded' | 'translated';
  // S3 key in the lesson media bucket.
  key: string;
  isDefault: boolean;
  // On a translated track only: the trackId of the default track it was made
  // from.
  sourceTrackId?: string;
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
  // The translated track an uploaded add of a new language evicted from a
  // full list, so its file can be deleted.
  evicted?: CaptionTrack;
  // Every translated track of the version, taken out because the version's
  // default track is now another track: they were made from the old one.
  staleTranslated?: CaptionTrack[];
  // An add that was not applied: an auto add because an uploaded track already
  // holds the language (a late Transcribe result never overwrites an
  // instructor's upload), or a translated add that lost to an upload, a
  // newer source, a translation of the same source or a full list. The caller
  // logs it; an auto caller still treats captioning as done.
  dropped?: true;
}

const isDefaultOf = (nonce: string) => (t: CaptionTrack) =>
  t.nonce === nonce && t.isDefault;

// The translated track to make room for an upload: the one whose language is
// last in the course's caption languages, or the last added when none is listed.
const pickEvicted = (
  tracks: readonly CaptionTrack[],
  nonce: string,
  captionLanguages: readonly string[] | undefined,
): CaptionTrack | undefined => {
  const translated = tracks.filter(
    (t) => t.nonce === nonce && t.source === 'translated',
  );
  const listed = translated
    .map((t) => ({ t, index: captionLanguages?.indexOf(t.language) ?? -1 }))
    .filter(({ index }) => index !== -1)
    .sort((a, b) => b.index - a.index);
  return listed[0]?.t ?? translated.at(-1);
};

const applyAdd = (
  tracks: CaptionTrack[],
  change: Extract<CaptionChange, { type: 'add' }>,
  captionLanguages: readonly string[] | undefined,
): CaptionChangeResult => {
  const added = change.track;
  const nonce = change.nonce;
  const sameLanguage = tracks.findIndex(
    (t) => t.nonce === nonce && t.language === added.language,
  );
  const held = sameLanguage === -1 ? undefined : tracks[sameLanguage];

  if (added.source === 'translated') {
    const source = tracks.find(isDefaultOf(nonce));
    if (
      (held &&
        (held.source !== 'translated' ||
          held.sourceTrackId === added.sourceTrackId)) ||
      !source ||
      added.sourceTrackId !== source.trackId
    ) {
      return { tracks, dropped: true };
    }
    const track = { ...added, isDefault: false };
    if (held) {
      tracks[sameLanguage] = track;
      return { tracks, replaced: held };
    }
    if (tracks.length >= MAX_CAPTION_TRACKS) {
      return { tracks, dropped: true };
    }
    return { tracks: [...tracks, track] };
  }

  // An auto track becomes the default, so the translated tracks made from the
  // old one go, the one holding the language being the one it replaces.
  let replaced: CaptionTrack | undefined;
  let staleTranslated: CaptionTrack[] | undefined;
  let list = tracks;
  if (added.source === 'auto') {
    const translated = tracks.filter(
      (t) => t.nonce === nonce && t.source === 'translated',
    );
    replaced = translated.find((t) => t.language === added.language);
    const rest = translated.filter((t) => t !== replaced);
    staleTranslated = rest.length > 0 ? rest : undefined;
    list = tracks.filter((t) => !translated.includes(t));
  } else if (held?.source === 'translated') {
    replaced = held;
    list = tracks.filter((t) => t !== held);
  }

  const sameIndex = replaced
    ? -1
    : list.findIndex((t) => t.nonce === nonce && t.language === added.language);
  const result = (r: CaptionChangeResult): CaptionChangeResult => ({
    ...r,
    ...(replaced ? { replaced } : {}),
    ...(staleTranslated ? { staleTranslated } : {}),
  });

  if (sameIndex !== -1) {
    const existing = list[sameIndex];
    if (added.source === 'auto' && existing.source === 'uploaded') {
      return { tracks, dropped: true };
    }
    list[sameIndex] = { ...added, isDefault: existing.isDefault };
    return result({ tracks: list, replaced: existing });
  }

  let evicted: CaptionTrack | undefined;
  if (list.length >= MAX_CAPTION_TRACKS) {
    evicted =
      added.source === 'uploaded' && !replaced
        ? pickEvicted(list, nonce, captionLanguages)
        : undefined;
    if (!evicted) {
      throw new CaptionTrackError(
        'TOO_MANY_TRACKS',
        `A video can have at most ${MAX_CAPTION_TRACKS} caption tracks`,
      );
    }
    list = list.filter((t) => t !== evicted);
  }
  const hasDefault = list.some(isDefaultOf(nonce));
  const extra = evicted ? { evicted } : {};
  if (added.source === 'auto') {
    // The auto track is the default whenever it exists.
    return result({
      tracks: [
        ...list.map((t) =>
          t.nonce === nonce ? { ...t, isDefault: false } : t,
        ),
        { ...added, isDefault: true },
      ],
    });
  }
  return result({
    tracks: [...list, { ...added, isDefault: !hasDefault }],
    ...extra,
  });
};

const applyRemove = (
  tracks: CaptionTrack[],
  change: Extract<CaptionChange, { type: 'remove' }>,
): CaptionChangeResult => {
  const index = tracks.findIndex((t) => t.trackId === change.trackId);
  if (index === -1) {
    return { tracks };
  }
  const [removed] = tracks.splice(index, 1);
  if (removed.isDefault) {
    const oldest = tracks.find(
      (t) => t.nonce === change.nonce && t.source !== 'translated',
    );
    if (oldest) {
      tracks[tracks.indexOf(oldest)] = { ...oldest, isDefault: true };
    }
  }
  return { tracks, removed };
};

/**
 * The tracks after a change, as a new list. `currentNonce` is the nonce of the
 * item's current ready version: a change for any other version is refused with
 * STALE_VERSION. `captionLanguages` is the course's, in order: it decides
 * which translated track an upload evicts from a full list.
 */
export const applyCaptionChange = (
  current: readonly CaptionTrack[] | undefined,
  change: CaptionChange,
  {
    currentNonce,
    captionLanguages,
  }: {
    currentNonce: string | undefined;
    captionLanguages?: readonly string[];
  },
): CaptionChangeResult => {
  if (currentNonce === undefined || change.nonce !== currentNonce) {
    throw new CaptionTrackError('STALE_VERSION', 'The video changed');
  }
  const tracks = [...(current ?? [])];
  const before = tracks.find(isDefaultOf(change.nonce))?.trackId;
  const result =
    change.type === 'remove'
      ? applyRemove(tracks, change)
      : applyAdd(tracks, change, captionLanguages);

  // Translated tracks were made from the default they name: when another
  // track is the default now, they all go.
  const after = result.tracks.find(isDefaultOf(change.nonce))?.trackId;
  if (after === before) {
    return result;
  }
  const stale = result.tracks.filter(
    (t) => t.nonce === change.nonce && t.source === 'translated',
  );
  if (stale.length === 0) {
    return result;
  }
  return {
    ...result,
    tracks: result.tracks.filter((t) => !stale.includes(t)),
    staleTranslated: [...(result.staleTranslated ?? []), ...stale],
  };
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

export interface CaptionTranslationSettings {
  enabled: boolean;
  maxLanguagesPerCourse: number;
}

export type CaptionLanguageState =
  | {
      language: string;
      state: 'uploaded' | 'translated' | 'no-room' | 'pending';
    }
  | {
      language: string;
      state: 'not-translated';
      reason: 'disabled' | 'no-captions' | 'language-mismatch';
    };

export interface CaptionTranslationPlan {
  // The version's default track, which every translation is made from.
  sourceTrack?: CaptionTrack;
  // Languages to make now, in the course's order.
  translate: string[];
  // Translated tracks no longer wanted.
  remove: CaptionTrack[];
  // One entry per course language.
  languages: CaptionLanguageState[];
}

/**
 * What translating a version's default track into a course's caption
 * languages still needs: which languages to make, which translated tracks to
 * remove, and the state of each course language. Pure; only the tracks of
 * `nonce` count.
 */
export const planCaptionTranslations = (
  tracks: readonly CaptionTrack[] | undefined,
  {
    nonce,
    captionLanguages,
    courseLanguage,
    settings,
  }: {
    nonce: string;
    captionLanguages: readonly string[] | undefined;
    courseLanguage: string | undefined;
    settings: CaptionTranslationSettings;
  },
): CaptionTranslationPlan => {
  const version = dropOtherVersions(tracks, nonce);
  const sourceTrack = version.find((t) => t.isDefault);
  const wanted = captionLanguages ?? [];
  const translatedTracks = version.filter((t) => t.source === 'translated');
  const holder = (language: string) =>
    version.find((t) => t.language === language);

  if (!settings.enabled) {
    return {
      sourceTrack,
      translate: [],
      remove: [],
      languages: wanted.map((language) => ({
        language,
        state: 'not-translated',
        reason: 'disabled',
      })),
    };
  }

  const mismatch =
    sourceTrack?.source === 'auto' &&
    courseLanguage !== undefined &&
    courseLanguage !== sourceTrack.language.split('-')[0];
  const unwanted = new Set(
    translatedTracks.filter((t) => !wanted.includes(t.language)),
  );
  const translate: string[] = [];
  // The places the translated tracks may take, once the others have theirs.
  let room =
    MAX_CAPTION_TRACKS -
    version.filter((t) => t.source !== 'translated').length;

  const languages = wanted.map((language): CaptionLanguageState => {
    const held = holder(language);
    if (!sourceTrack) {
      return { language, state: 'not-translated', reason: 'no-captions' };
    }
    if (held && held.source !== 'translated') {
      return { language, state: 'uploaded' };
    }
    if (mismatch) {
      if (held) {
        unwanted.add(held);
      }
      return { language, state: 'not-translated', reason: 'language-mismatch' };
    }
    const current = held?.sourceTrackId === sourceTrack.trackId;
    if (room <= 0) {
      if (held) {
        unwanted.add(held);
      }
      return { language, state: 'no-room' };
    }
    room -= 1;
    if (current) {
      return { language, state: 'translated' };
    }
    translate.push(language);
    return { language, state: 'pending' };
  });

  return { sourceTrack, translate, remove: [...unwanted], languages };
};

// The shape of ElectroDB's where() callback arguments, as much as this needs.
// Its operations build condition strings, which are combined as text.
interface ConditionOps {
  eq(attribute: unknown, value: unknown): string;
  exists(attribute: unknown): string;
  notExists(attribute: unknown): string;
  contains(attribute: unknown, value: unknown): string;
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
  (attr: ConditionAttributes, op: ConditionOps): string => {
    const revision = op.eq(attr.captionTracksRev, rev);
    return [
      rev === 0
        ? `(${op.notExists(attr.captionTracksRev)} OR ${revision})`
        : revision,
      op.eq(attr.status, 'ready'),
      op.contains(attr.s3Key, `/${nonce}/`),
    ].join(' AND ');
  };

/** A content item's key, or a course's for its preview video. */
export type CaptionTargetKey =
  | {
      courseId: string;
      moduleId: string;
      lessonId: string;
      contentItemId: string;
    }
  | { courseId: string };

/** Whether the key is a `coursePreview`'s (a course's, with no content item). */
export const isPreviewKey = (
  key: CaptionTargetKey,
): key is { courseId: string } => !('contentItemId' in key);

// What the writers below need of an ElectroDB patch or get, loosely typed
// because the two entities' own types differ only in their keys. The entity
// calls themselves stay typed, so the invariant coverage scan sees the writes.
interface PatchBuilder {
  set(values: Record<string, unknown>): PatchBuilder;
  remove(attributes: string[]): PatchBuilder;
  where(condition: unknown): PatchBuilder;
  go(): Promise<unknown>;
}
interface CaptionRecord {
  status?: string;
  s3Key?: string;
  captionsStatus?: string;
  captionTracks?: CaptionTrack[];
  captionTracksRev?: number;
}
export type CaptionEntities = Pick<
  Awaited<ReturnType<typeof createCoreTableService>>['entities'],
  'contentItem' | 'coursePreview'
>;

const recordExists = (attr: { status: unknown }, op: ConditionOps): string =>
  op.exists(attr.status);

/** The `.where()` condition for a write while the record still plays `nonce`. */
const playsReadyVersion =
  (nonce: string) =>
  (attr: { status: unknown; s3Key: unknown }, op: ConditionOps): string =>
    [op.eq(attr.status, 'ready'), op.contains(attr.s3Key, `/${nonce}/`)].join(
      ' AND ',
    );

const patchOf = (
  entities: CaptionEntities,
  key: CaptionTargetKey,
): PatchBuilder =>
  (isPreviewKey(key)
    ? entities.coursePreview.patch(key)
    : entities.contentItem.patch(key)) as unknown as PatchBuilder;

/**
 * The `.where()` condition for a write while the record still plays the
 * version the job was for and is still waiting for its captions.
 */
export const captionsStillPending =
  (nonce: string) =>
  (
    attr: { status: unknown; s3Key: unknown; captionsStatus: unknown },
    op: ConditionOps,
  ): string =>
    [
      op.eq(attr.status, 'ready'),
      op.contains(attr.s3Key, `/${nonce}/`),
      op.eq(attr.captionsStatus, 'pending'),
    ].join(' AND ');

/** Reads the record a caption job's writers patch (a preview, or a content item). */
export const getCaptionRecord = async (
  entities: CaptionEntities,
  key: CaptionTargetKey,
): Promise<CaptionRecord | null | undefined> =>
  (isPreviewKey(key)
    ? await entities.coursePreview.get(key).go()
    : await entities.contentItem.get(key).go()
  ).data;

/**
 * Marks the version's captioning failed, if it is still waiting. Throws
 * ElectroDB's conditional check failure when it no longer is.
 */
export const writeCaptionsFailed = async (
  entities: CaptionEntities,
  key: CaptionTargetKey,
  nonce: string,
): Promise<void> => {
  await patchOf(entities, key)
    .set({ captionsStatus: 'failed' })
    .remove(['captionsPendingSince'])
    .where(captionsStillPending(nonce))
    .go();
};

/** Marks the version's captioning ready without adding a track. */
export const writeCaptionsReady = async (
  entities: CaptionEntities,
  key: CaptionTargetKey,
  nonce: string,
): Promise<void> => {
  await patchOf(entities, key)
    .set({ captionsStatus: 'ready' })
    .remove(['captionsPendingSince'])
    .where(captionsStillPending(nonce))
    .go();
};

/**
 * Writes the version's new track list, conditioned on the revision read
 * (captionWriteCondition) and moving it on, and marks captioning ready.
 */
export const writeCaptionTracks = async (
  entities: CaptionEntities,
  key: CaptionTargetKey,
  {
    tracks,
    rev,
    nonce,
  }: { tracks: CaptionTrack[]; rev: number; nonce: string },
): Promise<void> => {
  await patchOf(entities, key)
    .set({
      captionTracks: tracks,
      captionTracksRev: rev + 1,
      captionsStatus: 'ready',
    })
    .remove(['captionsPendingSince'])
    .where(captionWriteCondition(rev, nonce))
    .go();
};

/**
 * Asks for the record's translations to be worked out again: clears the
 * recorded outcome and touches captionTranslationRequestedAt, which is what the
 * stream matcher passes. A missing record is left missing.
 */
export const requestCaptionTranslation = async (
  entities: CaptionEntities,
  key: CaptionTargetKey,
): Promise<void> => {
  try {
    await patchOf(entities, key)
      .set({ captionTranslationRequestedAt: new Date().toISOString() })
      .remove(['captionTranslation'])
      .where(recordExists)
      .go();
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
  }
};

/**
 * Records what a translation run could not do (or clears the record when it
 * did everything), while the record still plays `nonce`. It never touches
 * the tracks or the captioning status.
 */
export const writeCaptionTranslationOutcome = async (
  entities: CaptionEntities,
  key: CaptionTargetKey,
  {
    nonce,
    sourceTrackId,
    failures,
  }: {
    nonce: string;
    sourceTrackId: string;
    failures: { language: string; reason: 'failed' | 'too-long' }[];
  },
): Promise<void> => {
  const patch = patchOf(entities, key);
  await (failures.length === 0
    ? patch.remove(['captionTranslation'])
    : patch.set({
        captionTranslation: {
          sourceTrackId,
          failures,
          updatedAt: new Date().toISOString(),
        },
      })
  )
    .where(playsReadyVersion(nonce))
    .go();
};
