/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from '../electro.js';

export const createGadgetEntity = () =>
  new Entity({ model: { entity: 'gadget', version: '1' } });
