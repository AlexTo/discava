/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from './init.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  renameCategory,
} from './procedures/category.js';
import {
  getCertificate,
  restoreCertificate,
  revokeCertificate,
} from './procedures/certificate.js';
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
  category: router({
    list: listCategories,
    create: createCategory,
    rename: renameCategory,
    archive: archiveCategory,
  }),
  certificate: router({
    get: getCertificate,
    revoke: revokeCertificate,
    restore: restoreCertificate,
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
