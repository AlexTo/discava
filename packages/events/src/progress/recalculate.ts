/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type Certificate,
  type Curriculum,
  certificateReminderDueAt,
  computeProgress,
  type createCoreTableService,
  evaluateCertificateCriteria,
  isConditionalCheckFailed,
  issueCertificate,
  markCertificateReminderScheduled,
} from '@discava/core-table';
import { scheduleCertificateReminder } from '../certificates/reminder-schedule.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// A write that may lose to a completion recorded at the same moment by
// another run: that run's result stands, since completion is permanent.
// Returns whether this write was the one that landed.
const unlessAlreadyCompleted = async (write: () => Promise<unknown>) => {
  try {
    await write();
    return true;
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    return false;
  }
};

// The students to recalculate when a course's curriculum changes: everyone
// enrolled who hasn't dropped out.
export const listEnrolledStudents = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<string[]> => {
  const { data } = await coreTable.entities.enrolment.query
    .primary({ courseId })
    .go({ pages: 'all' });
  return data
    .filter(({ status }) => status !== 'dropped')
    .map(({ userId }) => userId);
};

// Recomputes one student's progress in a course from scratch and writes what
// changed: each lesson's progress, and the enrolment's progressPercent, with
// status 'completed' and completedAt at 100%. Completion is permanent: a
// lesson or course already completed is never written back to anything else,
// and the writes that complete them are conditioned on that, so a run racing
// another can't undo it. A student who isn't enrolled, or has dropped out,
// is left alone. Once the enrolment is completed, the student's certificate
// is issued if they don't have one yet and meet the course's certificate
// criteria (completion is recorded either way), and its one reminder is
// scheduled unless it was already, sent, made unnecessary by a click, or is too
// late (an error from either propagates, so the batch is retried and a failed
// issue or schedule is picked up on the next pass).
export const recalculateStudent = async (
  coreTable: CoreTable,
  courseId: string,
  curriculum: Curriculum,
  userId: string,
  now: string = new Date().toISOString(),
) => {
  const [{ data: enrolment }, { data: completions }, { data: existing }] =
    await Promise.all([
      coreTable.entities.enrolment.get({ courseId, userId }).go(),
      coreTable.entities.itemCompletion.query
        .primary({ userId, courseId })
        .go({ pages: 'all' }),
      coreTable.entities.progress.query
        .primary({ userId, courseId })
        .go({ pages: 'all' }),
    ]);
  if (!enrolment || enrolment.status === 'dropped') {
    return;
  }

  const result = computeProgress(
    curriculum,
    new Set(completions.map(({ contentItemId }) => contentItemId)),
  );

  const currentStatus = new Map(
    existing.map(({ lessonId, status }) => [lessonId, status]),
  );
  for (const { lessonId, status } of result.lessons) {
    // No record already means not started, so a lesson the student hasn't
    // touched isn't written.
    const current = currentStatus.get(lessonId) ?? 'not_started';
    if (current === 'completed' || current === status) {
      continue;
    }
    await unlessAlreadyCompleted(() =>
      coreTable.entities.progress
        .upsert({
          userId,
          courseId,
          lessonId,
          status,
          ...(status === 'completed' && { completedAt: now }),
        })
        .where(
          (attr, op) =>
            `${op.notExists(attr.status)} OR ${op.ne(attr.status, 'completed')}`,
        )
        .go(),
    );
  }

  if (enrolment.progressPercent !== result.progressPercent) {
    await unlessAlreadyCompleted(() =>
      coreTable.entities.enrolment
        .patch({ courseId, userId })
        .set({ progressPercent: result.progressPercent })
        .where((attr, op) => op.ne(attr.status, 'dropped'))
        .go(),
    );
  }
  let completedAt = enrolment.completedAt;
  let completed = enrolment.status === 'completed';
  if (result.completed && enrolment.status === 'active') {
    completed = true;
    const won = await unlessAlreadyCompleted(() =>
      coreTable.entities.enrolment
        .patch({ courseId, userId })
        .set({ status: 'completed', completedAt: now })
        .where((attr, op) => op.eq(attr.status, 'active'))
        .go(),
    );
    if (won) {
      completedAt = now;
    } else {
      // Another run completed it first, or the student dropped out in the
      // meantime: what's stored decides.
      const { data: current } = await coreTable.entities.enrolment
        .get({ courseId, userId })
        .go();
      completed = current?.status === 'completed';
      completedAt = current?.completedAt;
    }
  }
  if (!completed || !completedAt) {
    return;
  }

  const { data: existingCertificate } = await coreTable.entities.certificate
    .get({ userId, courseId })
    .go();
  let certificate: Certificate | undefined = existingCertificate ?? undefined;
  if (!certificate) {
    const [{ data: course }, { data: user }] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.user.get({ userId }).go(),
    ]);
    if (!course || !course.certificatesEnabled) {
      return;
    }
    // A quiz summary is only read when the criteria need one.
    const { data: quizSummaries } = course.certificateCriteria.requireQuizPass
      ? await coreTable.entities.quizSummary.query
          .primary({ userId, courseId })
          .go({ pages: 'all' })
      : { data: [] };
    // Likewise submissions, only when graded uploads are required. Read by
    // key and consistently, one per assignment: this runs on the stream
    // record of a grade, which the byUser index may not show yet.
    const submissions =
      course.certificateCriteria.minUploadScorePercent !== undefined
        ? (
            await Promise.all(
              curriculum.contentItems
                .filter(
                  (item) => (item as { type?: string }).type === 'assignment',
                )
                .map(({ contentItemId }) =>
                  coreTable.entities.assignmentSubmission
                    .get({ courseId, contentItemId, userId })
                    .go({ consistent: true }),
                ),
            )
          ).flatMap(({ data }) => (data ? [data] : []))
        : [];
    const evaluation = evaluateCertificateCriteria({
      criteria: course.certificateCriteria,
      curriculum,
      quizSummaries,
      submissions,
    });
    certificate = await issueCertificate({
      coreTable,
      enrolment: { userId, courseId, status: 'completed', completedAt },
      course,
      evaluation,
      user,
      now: new Date(now),
    });
  }
  if (
    !certificate ||
    certificate.reminderScheduledAt ||
    certificate.reminderSentAt ||
    certificate.linkedInClickedAt
  ) {
    return;
  }
  // A reminder is never sent late: past its due time, nothing is scheduled.
  const dueAt = certificateReminderDueAt(certificate);
  if (dueAt <= now) {
    return;
  }
  await scheduleCertificateReminder({
    userId,
    courseId,
    certificateId: certificate.certificateId,
    dueAt,
  });
  await markCertificateReminderScheduled({
    coreTable,
    userId,
    courseId,
    now: new Date(now),
  });
};
