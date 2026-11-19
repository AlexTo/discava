/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from '../electro.js';

export const createWidgetEntity = () =>
  new Entity({ model: { entity: 'widget', version: '1' } });
