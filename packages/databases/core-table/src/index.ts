/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export {
  dynamoDBClientConfig,
  getDynamoDBClient,
  resolveTableName,
} from './client.js';
export { PREVIEW_MAX_SECONDS } from './entities/course-preview.js';
export * from './entities/index.js';
export {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  HEADLINE_MAX,
  isValidHandle,
} from './entities/instructor-profile.js';
export {
  aggregatesOf,
  type Contributions,
  contributions,
  contributionsOfChange,
  type Delta,
  dayKey,
  diffContributions,
  type ExpectedAggregate,
  type FunnelTask,
  funnelTasksOfChange,
  type Member,
  mergeCounts,
  sumContributions,
  weekKey,
} from './helpers/analytics.js';
export {
  type CourseAnalytics,
  type CourseDay,
  type CourseSummary,
  type LessonFunnel,
  MIN_RANKED_ATTEMPTS,
  type QuizAnalytics,
  type QuizListing,
  type QuizQuestionFigures,
  readCourseAnalytics,
  readCourseQuizzes,
  readCourseSummaries,
  readLessonFunnel,
  readQuizAnalytics,
  type ScoreBand,
} from './helpers/analytics-reads.js';
export { rebuildCourseAnalytics } from './helpers/analytics-rebuild.js';
export {
  ANALYTICS_STREAM_FILTERS,
  type AnalyticsStreamRecord,
  matchesAnalyticsStreamFilters,
} from './helpers/analytics-stream.js';
export {
  type WaitForAnalyticsOptions,
  waitForAnalytics,
} from './helpers/analytics-wait.js';
export {
  type AnalyticsChange,
  type AnalyticsChangeResult,
  applyAnalyticsChange,
  type FunnelMove,
  moveLessonFunnel,
  moveStudentFunnels,
} from './helpers/analytics-writes.js';
export {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_PAGE_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  type AnnouncementCreate,
  type AnnouncementDelete,
  type AnnouncementEdit,
  AnnouncementInputError,
  type AnnouncementPageInput,
  announcementDeleteWrites,
  announcementEditWrites,
  announcementIdTime,
  announcementPage,
  announcementWrites,
  uuidV7Time,
} from './helpers/announcement.js';
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
  CATEGORY_NAME_MAX_LENGTH,
  categoryNameKey,
  categorySlug,
  DURATION_HOURS_MAX,
  DURATION_HOURS_MIN,
  LANGUAGES,
  type Language,
  LEVELS,
  type Level,
  MAX_TAGS,
  normaliseCategoryName,
  normaliseTags,
  TAG_MAX_LENGTH,
} from './helpers/catalogue.js';
export { type CategoryCreate, categoryWrites } from './helpers/category.js';
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
  type CourseCatalogue,
  courseCatalogueWrites,
} from './helpers/course-catalogue.js';
export {
  type CourseLandingSet,
  courseLandingWrites,
  LANDING_ITEM_MAX_LENGTH,
  LANDING_LIST_MAX_ITEMS,
  normaliseLandingList,
} from './helpers/course-landing.js';
export {
  CURRICULUM_ENTITIES,
  filterEffectivelyVisible,
  isShown,
} from './helpers/curriculum.js';
export {
  type AnsweredState,
  answeredState,
  checkPostId,
  DISCUSSION_BODY_MAX,
  DISCUSSION_MAX_REPORTERS,
  DISCUSSION_MAX_VISIBLE_REPLIES,
  DISCUSSION_POST_ID_WINDOW_MS,
  DISCUSSION_TITLE_MAX,
  type DiscussionAuthor,
  DiscussionInputError,
  type DiscussionOperation,
  type DiscussionPostRead,
  type DiscussionQuestionRead,
  type DiscussionTextProblem,
  discussionWrites,
  lessonHasDiscussion,
  type NormalisedDiscussionText,
  normaliseDiscussionText,
  type PostIdCheck,
  type PostIdProblem,
  postIdTime,
} from './helpers/discussion.js';
export {
  DISCUSSION_EXCERPT_MAX,
  type DiscussionNotificationEvent,
  type DiscussionNotificationPost,
  discussionExcerpt,
  discussionNotificationWrites,
} from './helpers/discussion-notifications.js';
export {
  InvalidRequestError,
  isConditionalCheckFailed,
  NameConflictError,
  NotFoundError,
  SlugUnavailableError,
  VersionConflictError,
} from './helpers/errors.js';
export {
  defaultDisplayName,
  type EnsureInstructorProfileResult,
  ensureInstructorProfile,
  handleCandidates,
  handleFromName,
  instructorProfileWrites,
  RESERVED_HANDLES,
} from './helpers/instructor-profile.js';
export {
  checkAnalyticsMatchesRecords,
  checkTableInvariants,
  INVARIANTS,
  type InvariantName,
  type InvariantViolation,
  loadTableSnapshot,
  type TableSnapshot,
  violationId,
} from './helpers/invariants.js';
export {
  type NotificationInput,
  type NotificationTransactionItems,
  type NotifyCourseStudentsInput,
  notificationBroadcastId,
  notificationId,
  notificationPosition,
  notificationWrites,
  notifyCourseStudents,
  parseNotificationPosition,
  publishNotification,
} from './helpers/notification.js';
export {
  claimEmail,
  type EmailSkipReason,
  markEmailFailed,
  markEmailSent,
  markEmailUnknown,
  type NotificationKey,
  notificationEmailTransitions,
  readEmailState,
  releaseEmailClaim,
  skipEmail,
} from './helpers/notification-email.js';
export { setNotificationPreference } from './helpers/notification-preference.js';
export {
  MARK_ALL_CHUNK,
  markNotificationRead,
  markNotificationsRead,
} from './helpers/notification-read.js';
export {
  matchesNotificationStreamFilters,
  NOTIFICATION_STREAM_FILTERS,
  type NotificationStreamRecord,
} from './helpers/notification-stream.js';
export {
  buildNotification,
  type EmailPolicy,
  NOTIFICATION_TYPES,
  NotificationInputError,
  type NotificationPortal,
  type NotificationType,
} from './helpers/notification-types.js';
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
  classifyReviewCancellation,
  type ReviewCancellation,
  type ReviewDelete,
  type ReviewDeleteResponse,
  type ReviewEdit,
  type ReviewPost,
  type ReviewRemove,
  type ReviewRespond,
  type ReviewWrite,
  removalReason,
  responseText,
  reviewerName,
  reviewNotifications,
  reviewText,
  reviewWrites,
} from './helpers/review.js';
export {
  PRIOR_MEAN,
  PRIOR_WEIGHT,
  ratingAverage,
  ratingBoost,
  ratingCount,
  type StarField,
  type Stars,
  starCounts,
  starField,
  weightedRating,
} from './helpers/review-rating.js';
export {
  matchesSearchStreamFilters,
  SEARCH_STREAM_FILTERS,
  type SearchStreamRecord,
} from './helpers/search-stream.js';
export {
  featuresFor,
  STREAM_FEATURES,
  type StreamFeature,
  type StreamFilter,
  type StreamRecordLike,
} from './helpers/stream-features.js';
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
