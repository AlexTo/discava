/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { PaymentsScreen } from './-components/payments-screen';

export const Route = createFileRoute('/payments')({
  component: PaymentsScreen,
});
