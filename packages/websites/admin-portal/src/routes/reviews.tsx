/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { ReviewsScreen } from './-components/reviews-screen';

export const Route = createFileRoute('/reviews')({
  component: ReviewsScreen,
});
