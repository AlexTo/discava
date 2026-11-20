/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from '../../table/src/electro.js';
import { widgetWrites } from '../../table/src/helpers/widget.js';

// None of these are writes the map lists: a Map's delete, a core-table
// helper (whose own write is listed under core-table), and an entity
// declared outside the entities folder.
export const notWrites = () => {
  new Map<string, string>().delete('key');
  widgetWrites.create('w');
  new Entity({ model: { entity: 'stray', version: '1' } }).put({});
};
