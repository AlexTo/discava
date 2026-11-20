/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createService } from './electro.js';
import { createGadgetEntity } from './entities/gadget.js';
import { createUnusedEntity } from './entities/unused.js';
import { createWidgetEntity } from './entities/widget.js';

export const service = createService({
  gadget: createGadgetEntity(),
  unused: createUnusedEntity(),
  widget: createWidgetEntity(),
});
