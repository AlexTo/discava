/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CertificateAssessment } from '@discava/core-table';

type StatementInput = Pick<
  CertificateAssessment,
  | 'itemCount'
  | 'requireQuizPass'
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
 * the public: never `assessedItems` or `criteriaVersion`. Line 3 (graded
 * assignments) arrives with Phase 8.
 */
export const assessmentStatement = (assessment: StatementInput): string[] => {
  const lines = [
    `Completed all ${plural(assessment.itemCount, 'item')} of the course.`,
  ];

  if (assessment.assessedItemCount > 0) {
    const lowest = assessment.passMarkLowest;
    const highest = assessment.passMarkHighest;
    if (lowest !== undefined && highest !== undefined) {
      lines.push(
        `Passed ${plural(assessment.assessedItemCount, 'assessed quiz', 'assessed quizzes')}. ${
          lowest === highest
            ? `Pass mark: ${lowest}%.`
            : `Pass marks: ${lowest}% to ${highest}%.`
        }`,
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
