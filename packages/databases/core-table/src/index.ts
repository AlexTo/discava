/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export {
  dynamoDBClientConfig,
  getDynamoDBClient,
  resolveTableName,
} from './client.js';
export * from './entities/index.js';
export {
  type AssignmentSubmissionFile,
  type AssignmentSubmissionWrite,
  assignmentSubmissionWrites,
  isLateSubmission,
} from './helpers/assignment-submission.js';
export {
  applyCaptionChange,
  CAPTIONS_PENDING_TIMEOUT_MS,
  type CaptionChange,
  type CaptionChangeResult,
  type CaptionTrack,
  CaptionTrackError,
  type CaptionTrackErrorCode,
  captionWriteCondition,
  dropOtherVersions,
  MAX_CAPTION_TRACKS,
  reportedCaptionsStatus,
  tracksForPlayback,
} from './helpers/caption-tracks.js';
export {
  type Certificate,
  formatCertificateId,
  generateCertificateId,
  type IssueCertificateInput,
  issueCertificate,
  learnerName,
  normaliseCertificateId,
} from './helpers/certificate.js';
export {
  TRANSCODE_PENDING_ATTRIBUTES,
  transcodePendingFrom,
} from './helpers/content-item.js';
export {
  CURRICULUM_ENTITIES,
  filterEffectivelyVisible,
  isShown,
} from './helpers/curriculum.js';
export { isConditionalCheckFailed } from './helpers/errors.js';
export {
  checkTableInvariants,
  INVARIANTS,
  type InvariantName,
  type InvariantViolation,
  loadTableSnapshot,
  type TableSnapshot,
  violationId,
} from './helpers/invariants.js';
export {
  type Curriculum,
  computeProgress,
  type LessonStatus,
  type StudentProgress,
} from './helpers/progress.js';
export {
  matchesProgressStreamFilters,
  PROGRESS_STREAM_FILTERS,
  type ProgressStreamRecord,
} from './helpers/progress-stream.js';
export {
  matchesSearchStreamFilters,
  SEARCH_STREAM_FILTERS,
  type SearchStreamRecord,
} from './helpers/search-stream.js';
export {
  type StudentActivity,
  studentActivityAt,
  studentActivityWrites,
} from './helpers/student-activity.js';
export {
  type IUserProfile,
  profileChanged,
  syncUserProfile,
  userProfileFrom,
} from './helpers/user.js';
export {
  isValidPosition,
  resumeAt,
  VIDEO_POSITION_MAX_SECONDS,
  videoPositionToStore,
} from './helpers/video-position.js';
export { createCoreTableService } from './service.js';
