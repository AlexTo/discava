/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { playableVersion } from '@discava/common-server-utils/media-keys';
import {
  filterEffectivelyVisible,
  tracksForPlayback,
} from '@discava/core-table';

export interface IWatchableVideo {
  contentItemId: string;
  moduleId: string;
  lessonId: string;
  versionId: string;
  trackIds: string[];
}

interface ICurriculumItem {
  contentItemId: string;
  moduleId: string;
  lessonId: string;
  type?: string;
  status?: string;
  s3Key?: string;
  previousS3Key?: string;
  visibility: 'hidden' | 'visible';
  archivedAt?: string;
  captionTracks?: Parameters<typeof tracksForPlayback>[0];
}

/**
 * The videos of a course a student may watch now that have a caption track,
 * each with the version being played and that version's track ids. This is the
 * access rule of transcript search: a hit counts only if its video, version
 * and track are in this set. Reused by a later retrieval over one lesson.
 */
export const watchableVideos = (curriculum: {
  modules: {
    moduleId: string;
    visibility: 'hidden' | 'visible';
    archivedAt?: string;
  }[];
  lessons: {
    moduleId: string;
    lessonId: string;
    visibility: 'hidden' | 'visible';
    archivedAt?: string;
  }[];
  contentItems: ICurriculumItem[];
}): IWatchableVideo[] =>
  filterEffectivelyVisible(curriculum).contentItems.flatMap((item) => {
    const playable = item.type === 'video' ? playableVersion(item) : undefined;
    if (!playable) {
      return [];
    }
    const trackIds = tracksForPlayback(
      item.captionTracks,
      playable.versionId,
    ).map((track) => track.trackId);
    return trackIds.length > 0
      ? [
          {
            contentItemId: item.contentItemId,
            moduleId: item.moduleId,
            lessonId: item.lessonId,
            versionId: playable.versionId,
            trackIds,
          },
        ]
      : [];
  });
