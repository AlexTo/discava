/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { createContentExtensions } from './extensions.js';

// The schema every stored document must conform to. Built once.
let schema: ReturnType<typeof getSchema> | undefined;

// Whether `value` is a JSON string holding a document that conforms to the
// content schema (createContentExtensions), not just any JSON with
// `type: 'doc'`: only nodes and marks the editor can produce, each where it
// may go.
export const isValidTiptapDocument = (value: string): boolean => {
  try {
    schema ??= getSchema(createContentExtensions());
    const node = Node.fromJSON(schema, JSON.parse(value));
    node.check();
    return node.type.name === 'doc';
  } catch {
    return false;
  }
};

// A stored document's JSON, or undefined when there is none or it doesn't
// parse, so an editor or renderer starts empty instead of failing.
export const parseTiptapDocument = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};
