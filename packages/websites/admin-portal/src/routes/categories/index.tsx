/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { CategoriesScreen } from './-components/categories-screen';

export const Route = createFileRoute('/categories/')({
  component: CategoriesScreen,
});
