/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import type { IQuizQuestion } from '../schema/index.js';

// JSON with object keys sorted, so the same questions always serialise the
// same way. Array order is kept: reordering questions or options changes what
// a student sees.
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

// Hash of what a student sees: the questions, never the answer key or
// settings.
export const hashQuizQuestions = (questions: IQuizQuestion[]) =>
  createHash('sha256').update(canonicalJson(questions)).digest('hex');
