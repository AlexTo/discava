/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type CourseStatus = 'Published' | 'Draft' | 'Archived';

export const courseStatusStyles: Record<CourseStatus, string> = {
  Published:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  Draft: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  Archived: 'bg-muted text-muted-foreground',
};
