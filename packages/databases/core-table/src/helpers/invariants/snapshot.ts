/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { EntityItem } from 'electrodb';
import type { createAnnouncementEntity } from '../../entities/announcement.js';
import type { createAssignmentSubmissionEntity } from '../../entities/assignment-submission.js';
import type { createCategoryEntity } from '../../entities/category.js';
import type { createCategoryClaimEntity } from '../../entities/category-claim.js';
import type { createCertificateEntity } from '../../entities/certificate.js';
import type { createContentItemEntity } from '../../entities/content-item.js';
import type { createCouponEntity } from '../../entities/coupon.js';
import type { createCouponRedemptionEntity } from '../../entities/coupon-redemption.js';
import type { createCourseEntity } from '../../entities/course.js';
import type { createCourseInstructorEntity } from '../../entities/course-instructor.js';
import type { createCoursePreviewEntity } from '../../entities/course-preview.js';
import type { createCourseRatingEntity } from '../../entities/course-rating.js';
import type { createCourseStatsEntity } from '../../entities/course-stats.js';
import type { createDiscussionPostEntity } from '../../entities/discussion-post.js';
import type { createDiscussionVoteEntity } from '../../entities/discussion-vote.js';
import type { createEarningDayEntity } from '../../entities/earning-day.js';
import type { createEarningEntryEntity } from '../../entities/earning-entry.js';
import type { createEarningOrderEntity } from '../../entities/earning-order.js';
import type { createEnrolmentEntity } from '../../entities/enrolment.js';
import type { createInstructorProfileEntity } from '../../entities/instructor-profile.js';
import type { createItemCompletionEntity } from '../../entities/item-completion.js';
import type { createLessonEntity } from '../../entities/lesson.js';
import type { createLessonStatsEntity } from '../../entities/lesson-stats.js';
import type { createModuleEntity } from '../../entities/module.js';
import type { createNotificationEntity } from '../../entities/notification.js';
import type { createNotificationBroadcastEntity } from '../../entities/notification-broadcast.js';
import type { createNotificationPreferenceEntity } from '../../entities/notification-preference.js';
import type { createNotificationStateEntity } from '../../entities/notification-state.js';
import type { createOrderEntity } from '../../entities/order.js';
import type { createPaymentChangeEntity } from '../../entities/payment-change.js';
import type { createPaymentConnectionEntity } from '../../entities/payment-connection.js';
import type { createPayoutEntity } from '../../entities/payout.js';
import type { createPayoutAccountEntity } from '../../entities/payout-account.js';
import type { createPeriodStatsEntity } from '../../entities/period-stats.js';
import type { createProfileHandleClaimEntity } from '../../entities/profile-handle-claim.js';
import type { createProgressEntity } from '../../entities/progress.js';
import type { createQuizAttemptEntity } from '../../entities/quiz-attempt.js';
import type { createQuizQuestionStatsEntity } from '../../entities/quiz-question-stats.js';
import type { createQuizScoreStatsEntity } from '../../entities/quiz-score-stats.js';
import type { createQuizSummaryEntity } from '../../entities/quiz-summary.js';
import type { createReviewEntity } from '../../entities/review.js';
import type { createUserEntity } from '../../entities/user.js';
import type { createVideoPositionEntity } from '../../entities/video-position.js';
import type { createCoreTableService } from '../../service.js';

type Item<F extends () => Promise<any>> = EntityItem<Awaited<ReturnType<F>>>;

// The records the checks read, holding only the attributes they use, so
// tests can build them by hand.
export interface TableSnapshot {
  courses: Pick<
    Item<typeof createCourseEntity>,
    | 'courseId'
    | 'status'
    | 'publishedAt'
    | 'updatedAt'
    | 'lastChildOrder'
    | 'categoryId'
    | 'tags'
    | 'level'
    | 'language'
    | 'durationHours'
    | 'learningOutcomes'
    | 'requirements'
    | 'priceAmount'
    | 'priceCurrency'
    | 'pricedAt'
  >[];
  modules: Pick<
    Item<typeof createModuleEntity>,
    | 'courseId'
    | 'moduleId'
    | 'order'
    | 'visibility'
    | 'archivedAt'
    | 'publishedAt'
    | 'lastChildOrder'
  >[];
  lessons: Pick<
    Item<typeof createLessonEntity>,
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'kind'
    | 'order'
    | 'visibility'
    | 'archivedAt'
    | 'publishedAt'
    | 'lastChildOrder'
  >[];
  contentItems: Pick<
    Item<typeof createContentItemEntity>,
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'type'
    | 'status'
    | 'order'
    | 'visibility'
    | 'archivedAt'
    | 'publishedAt'
    | 'studentActivityCount'
    | 's3Key'
    | 'previousS3Key'
    | 'transcodePending'
    | 'transcodePendingSince'
    | 'submissionNonce'
    | 'captionTracks'
    | 'captionTracksRev'
    | 'captionsStatus'
    | 'captionsPendingSince'
    | 'fileName'
    | 'fileSize'
    | 'mimeType'
  >[];
  coursePreviews: Pick<
    Item<typeof createCoursePreviewEntity>,
    | 'courseId'
    | 'status'
    | 's3Key'
    | 'previousS3Key'
    | 'submissionNonce'
    | 'transcodePending'
    | 'transcodePendingSince'
    | 'failureReason'
    | 'durationSeconds'
    | 'captionTracks'
    | 'captionTracksRev'
    | 'captionsStatus'
    | 'captionsPendingSince'
  >[];
  courseInstructors: Pick<
    Item<typeof createCourseInstructorEntity>,
    'courseId' | 'instructorId' | 'courseUpdatedAt'
  >[];
  enrolments: Pick<
    Item<typeof createEnrolmentEntity>,
    | 'courseId'
    | 'userId'
    | 'status'
    | 'progressPercent'
    | 'completedAt'
    | 'lastActivityAt'
    | 'createdAt'
    | 'orderId'
  >[];
  itemCompletions: Pick<
    Item<typeof createItemCompletionEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'completedAt'
  >[];
  progress: Pick<
    Item<typeof createProgressEntity>,
    'userId' | 'courseId' | 'lessonId' | 'status' | 'completedAt'
  >[];
  quizAttempts: Pick<
    Item<typeof createQuizAttemptEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'attemptId'
    | 'answers'
    | 'correctQuestionIds'
    | 'scorePercent'
    | 'passed'
    | 'submittedAt'
  >[];
  quizSummaries: Pick<
    Item<typeof createQuizSummaryEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'attemptsUsed'
    | 'bestScore'
    | 'bestAttemptId'
    | 'passedAt'
  >[];
  assignmentSubmissions: Pick<
    Item<typeof createAssignmentSubmissionEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'file'
    | 'version'
    | 'submittedAt'
  >[];
  certificates: Pick<
    Item<typeof createCertificateEntity>,
    | 'userId'
    | 'courseId'
    | 'certificateId'
    | 'learnerName'
    | 'courseTitle'
    | 'completedAt'
    | 'issuedAt'
    | 'linkedInClickedAt'
    | 'linkedInClickSource'
  >[];
  videoPositions: Pick<
    Item<typeof createVideoPositionEntity>,
    | 'userId'
    | 'courseId'
    | 'lessonId'
    | 'contentItemId'
    | 'positionSeconds'
    | 'versionId'
  >[];
  users: Pick<Item<typeof createUserEntity>, 'userId'>[];
  // The analytics aggregates (not their markers, which only guard against
  // double counting).
  courseStats: Pick<
    Item<typeof createCourseStatsEntity>,
    'courseId' | 'enrolments' | 'completed' | 'dropped'
  >[];
  periodStats: Pick<
    Item<typeof createPeriodStatsEntity>,
    'courseId' | 'periodKey' | 'enrolments' | 'activeLearners'
  >[];
  lessonStats: Pick<
    Item<typeof createLessonStatsEntity>,
    'courseId' | 'lessonId' | 'inProgress' | 'completed'
  >[];
  quizQuestionStats: Pick<
    Item<typeof createQuizQuestionStatsEntity>,
    'courseId' | 'contentItemId' | 'questionId' | 'attempts' | 'misses'
  >[];
  quizScoreStats: Pick<
    Item<typeof createQuizScoreStatsEntity>,
    | 'courseId'
    | 'contentItemId'
    | 'band0'
    | 'band1'
    | 'band2'
    | 'band3'
    | 'band4'
    | 'band5'
    | 'band6'
    | 'band7'
    | 'band8'
    | 'band9'
  >[];
  notifications: Pick<
    Item<typeof createNotificationEntity>,
    | 'userId'
    | 'occurredAt'
    | 'id'
    | 'type'
    | 'link'
    | 'readAt'
    | 'email'
    | 'createdAt'
  >[];
  notificationStates: Pick<
    Item<typeof createNotificationStateEntity>,
    'userId' | 'unreadCount' | 'readThrough'
  >[];
  notificationPreferences: Pick<
    Item<typeof createNotificationPreferenceEntity>,
    'userId' | 'type'
  >[];
  notificationBroadcasts: Pick<
    Item<typeof createNotificationBroadcastEntity>,
    | 'id'
    | 'type'
    | 'courseId'
    | 'dedupeKey'
    | 'occurredAt'
    | 'status'
    | 'completedAt'
    | 'createdAt'
  >[];
  announcements: Pick<
    Item<typeof createAnnouncementEntity>,
    | 'courseId'
    | 'announcementId'
    | 'title'
    | 'body'
    | 'authorId'
    | 'createdAt'
    | 'editedAt'
    | 'version'
  >[];
  discussionPosts: Pick<
    Item<typeof createDiscussionPostEntity>,
    | 'courseId'
    | 'lessonId'
    | 'moduleId'
    | 'kind'
    | 'threadId'
    | 'postId'
    | 'authorId'
    | 'authorName'
    | 'authorIsInstructor'
    | 'title'
    | 'body'
    | 'state'
    | 'replyCount'
    | 'instructorReplyCount'
    | 'voteCount'
    | 'acceptedPostId'
    | 'reportedBy'
    | 'unanswered'
    | 'reported'
    | 'createdAt'
  >[];
  discussionVotes: Pick<
    Item<typeof createDiscussionVoteEntity>,
    'courseId' | 'userId' | 'lessonId' | 'threadId' | 'postId'
  >[];
  categories: Pick<
    Item<typeof createCategoryEntity>,
    'categoryId' | 'name' | 'slug' | 'status'
  >[];
  categoryClaims: Pick<
    Item<typeof createCategoryClaimEntity>,
    'claim' | 'categoryId'
  >[];
  reviews: Pick<
    Item<typeof createReviewEntity>,
    | 'courseId'
    | 'userId'
    | 'rating'
    | 'text'
    | 'reviewerName'
    | 'status'
    | 'version'
    | 'removedAt'
    | 'removedBy'
    | 'removedReason'
    | 'responseText'
    | 'responseAt'
    | 'responseById'
    | 'responseByName'
  >[];
  courseRatings: Pick<
    Item<typeof createCourseRatingEntity>,
    'courseId' | 'stars1' | 'stars2' | 'stars3' | 'stars4' | 'stars5'
  >[];
  instructorProfiles: Pick<
    Item<typeof createInstructorProfileEntity>,
    'instructorId' | 'handle' | 'displayName' | 'headline' | 'bio' | 'version'
  >[];
  profileHandleClaims: Pick<
    Item<typeof createProfileHandleClaimEntity>,
    'handle' | 'instructorId'
  >[];
  coupons: Pick<
    Item<typeof createCouponEntity>,
    | 'courseId'
    | 'code'
    | 'type'
    | 'value'
    | 'currency'
    | 'maxRedemptions'
    | 'redeemedCount'
  >[];
  couponRedemptions: Pick<
    Item<typeof createCouponRedemptionEntity>,
    'courseId' | 'code' | 'userId' | 'status' | 'reservedUntil'
  >[];
  orders: Pick<
    Item<typeof createOrderEntity>,
    | 'orderId'
    | 'userId'
    | 'courseId'
    | 'accountId'
    | 'mode'
    | 'listAmount'
    | 'amount'
    | 'currency'
    | 'status'
    | 'expiresAt'
    | 'checkoutSessionId'
    | 'paymentIntentId'
    | 'paidAt'
    | 'refundedAt'
    | 'refundedAmount'
    | 'refundReason'
    | 'createdAt'
  >[];
  // At most one (a singleton); a list so a stray second one is seen.
  paymentConnections: Pick<
    Item<typeof createPaymentConnectionEntity>,
    | 'status'
    | 'mode'
    | 'accountId'
    | 'accountName'
    | 'keyLast4'
    | 'webhookEndpointId'
    | 'webhookUrl'
    | 'latestCheckoutExpiresAt'
    | 'leaseUntil'
    | 'previousStatus'
    | 'revision'
    | 'changedAt'
  >[];
  paymentChanges: Pick<
    Item<typeof createPaymentChangeEntity>,
    | 'changeId'
    | 'kind'
    | 'byUserId'
    | 'byName'
    | 'at'
    | 'mode'
    | 'accountId'
    | 'keyLast4'
    | 'step'
  >[];
  payoutAccounts: Pick<
    Item<typeof createPayoutAccountEntity>,
    'instructorId' | 'accountId' | 'mode' | 'connectedAccountId' | 'status'
  >[];
  earningEntries: Pick<
    Item<typeof createEarningEntryEntity>,
    | 'instructorId'
    | 'courseId'
    | 'orderId'
    | 'accountId'
    | 'mode'
    | 'entryId'
    | 'kind'
    | 'currency'
    | 'grossMinor'
    | 'discountMinor'
    | 'refundMinor'
    | 'feeMinor'
    | 'netMinor'
    | 'feeBasisPoints'
    | 'occurredAt'
    | 'releaseAt'
    | 'payoutId'
    | 'settlement'
  >[];
  earningDays: Pick<
    Item<typeof createEarningDayEntity>,
    | 'instructorId'
    | 'courseId'
    | 'currency'
    | 'day'
    | 'salesCount'
    | 'grossMinor'
    | 'discountMinor'
    | 'refundMinor'
    | 'feeMinor'
    | 'netMinor'
  >[];
  earningOrders: Pick<
    Item<typeof createEarningOrderEntity>,
    | 'orderId'
    | 'courseId'
    | 'currency'
    | 'accountId'
    | 'mode'
    | 'grossMinor'
    | 'discountMinor'
    | 'paidMinor'
    | 'feeMinor'
    | 'feeBasisPoints'
    | 'instructorIds'
    | 'refundedMinor'
  >[];
  payouts: Pick<
    Item<typeof createPayoutEntity>,
    | 'instructorId'
    | 'payoutId'
    | 'accountId'
    | 'mode'
    | 'currency'
    | 'status'
    | 'amountMinor'
    | 'entryCount'
    | 'transferId'
    | 'failureReason'
  >[];
}

// Each snapshot key and the entity whose records it holds. Adding an entity
// to the snapshot is its `TableSnapshot` field above and a line here.
export const SNAPSHOT_ENTITIES = {
  courses: 'course',
  modules: 'module',
  lessons: 'lesson',
  contentItems: 'contentItem',
  coursePreviews: 'coursePreview',
  courseInstructors: 'courseInstructor',
  enrolments: 'enrolment',
  itemCompletions: 'itemCompletion',
  progress: 'progress',
  quizAttempts: 'quizAttempt',
  quizSummaries: 'quizSummary',
  assignmentSubmissions: 'assignmentSubmission',
  certificates: 'certificate',
  videoPositions: 'videoPosition',
  users: 'user',
  courseStats: 'courseStats',
  periodStats: 'periodStats',
  lessonStats: 'lessonStats',
  quizQuestionStats: 'quizQuestionStats',
  quizScoreStats: 'quizScoreStats',
  notifications: 'notification',
  notificationStates: 'notificationState',
  notificationPreferences: 'notificationPreference',
  notificationBroadcasts: 'notificationBroadcast',
  announcements: 'announcement',
  categories: 'category',
  categoryClaims: 'categoryClaim',
  discussionPosts: 'discussionPost',
  discussionVotes: 'discussionVote',
  reviews: 'review',
  courseRatings: 'courseRating',
  instructorProfiles: 'instructorProfile',
  profileHandleClaims: 'profileHandleClaim',
  coupons: 'coupon',
  couponRedemptions: 'couponRedemption',
  orders: 'order',
  paymentConnections: 'paymentConnection',
  paymentChanges: 'paymentChange',
  payoutAccounts: 'payoutAccount',
  earningEntries: 'earningEntry',
  earningDays: 'earningDay',
  earningOrders: 'earningOrder',
  payouts: 'payout',
} as const satisfies Record<
  keyof TableSnapshot,
  keyof Awaited<ReturnType<typeof createCoreTableService>>['entities']
>;

export const emptyTableSnapshot = (): TableSnapshot =>
  Object.fromEntries(
    Object.keys(SNAPSHOT_ENTITIES).map((key) => [key, []]),
  ) as unknown as TableSnapshot;

// Reads every record the checks need. Scans the whole table, so it's for
// local and test tables, not a deployed one.
export const loadTableSnapshot = async (
  coreTable: Awaited<ReturnType<typeof createCoreTableService>>,
): Promise<TableSnapshot> => {
  const { entities } = coreTable;
  const keys = Object.keys(SNAPSHOT_ENTITIES) as (keyof TableSnapshot)[];
  const scans = await Promise.all(
    keys.map((key) =>
      (
        entities[SNAPSHOT_ENTITIES[key]].scan as {
          go: (options: { pages: 'all' }) => Promise<{ data: unknown[] }>;
        }
      ).go({ pages: 'all' }),
    ),
  );
  return Object.fromEntries(
    keys.map((key, i) => [key, scans[i].data]),
  ) as unknown as TableSnapshot;
};
