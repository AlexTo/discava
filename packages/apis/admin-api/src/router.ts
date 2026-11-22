/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from './init.js';
import {
  createBrandUploadUrl,
  getBranding,
  saveBranding,
} from './procedures/branding.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  renameCategory,
} from './procedures/category.js';
import {
  connectPayment,
  disconnectPayment,
  paymentStatus,
} from './procedures/payment.js';
import {
  listAdminReviews,
  listReviewCourses,
  removeReview,
} from './procedures/review.js';

export const router = t.router;

export const appRouter = router({
  branding: router({
    get: getBranding,
    createUploadUrl: createBrandUploadUrl,
    save: saveBranding,
  }),
  category: router({
    list: listCategories,
    create: createCategory,
    rename: renameCategory,
    archive: archiveCategory,
  }),
  payment: router({
    status: paymentStatus,
    connect: connectPayment,
    disconnect: disconnectPayment,
  }),
  review: router({
    courses: listReviewCourses,
    list: listAdminReviews,
    remove: removeReview,
  }),
});

export type AppRouter = typeof appRouter;
