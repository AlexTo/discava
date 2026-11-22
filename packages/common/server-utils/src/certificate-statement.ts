/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CertificateAssessment } from '@discava/core-table';

type StatementInput = Pick<
  CertificateAssessment,
  | 'itemCount'
  | 'requireQuizPass'
  | 'minUploadScorePercent'
  | 'assessedUploadCount'
  | 'assessedItemCount'
  | 'passMarkLowest'
  | 'passMarkHighest'
  | 'scoreBand'
> & { courseHours?: number };

const plural = (count: number, noun: string, many = `${noun}s`): string =>
  `${count} ${count === 1 ? noun : many}`;

/**
 * What a certificate confirms, as the lines the verification page and the PDF
 * both print (research R-12). Reads only what the certificate records for
 * the public: never `assessedItems` or `criteriaVersion`.
 */
export const assessmentStatement = (assessment: StatementInput): string[] => {
  const lines = [
    `Completed all ${plural(assessment.itemCount, 'item')} of the course.`,
  ];

  const uploads = assessment.assessedUploadCount ?? 0;
  const quizzes = assessment.assessedItemCount - uploads;
  if (assessment.assessedItemCount > 0) {
    const lowest = assessment.passMarkLowest;
    const highest = assessment.passMarkHighest;
    if (quizzes > 0 && lowest !== undefined && highest !== undefined) {
      lines.push(
        `Passed ${plural(quizzes, 'assessed quiz', 'assessed quizzes')}. ${
          lowest === highest
            ? `Pass mark: ${lowest}%.`
            : `Pass marks: ${lowest}% to ${highest}%.`
        }`,
      );
    }
    if (uploads > 0 && assessment.minUploadScorePercent !== undefined) {
      lines.push(
        `Graded assignments returned with at least ${assessment.minUploadScorePercent}%: ${uploads}.`,
      );
    }
    if (assessment.scoreBand !== undefined) {
      const band = assessment.scoreBand;
      lines.push(`Overall score: ${band}–${band >= 90 ? 100 : band + 9}%.`);
    }
  } else {
    lines.push('No graded assessment was required for this certificate.');
  }

  if (assessment.courseHours !== undefined) {
    lines.push(`Course length: ${plural(assessment.courseHours, 'hour')}.`);
  }
  return lines;
};
