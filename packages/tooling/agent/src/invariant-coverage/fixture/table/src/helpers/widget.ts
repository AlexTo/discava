/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { service } from '../service.js';

// A helper: what every writer calls to keep a shared rule.
export const widgetWrites = {
  create: (widgetId: string) => service.entities.widget.put({ widgetId }),
};
