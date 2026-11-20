/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from '../electro.js';

export const createUnusedEntity = () =>
  new Entity({ model: { entity: 'unused', version: '1' } });
