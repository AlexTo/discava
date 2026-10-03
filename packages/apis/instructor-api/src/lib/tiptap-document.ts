/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';

// The instructor portal's editor runs StarterKit (rich-text-editor.tsx), so
// this is the schema a document it produces conforms to. Built once.
let schema: ReturnType<typeof getSchema> | undefined;

// Whether `value` is a JSON string holding a document that conforms to the
// editor's node and mark schema, not just any JSON with `type: 'doc'`.
export const isValidTiptapDocument = (value: string): boolean => {
  try {
    schema ??= getSchema([StarterKit]);
    const node = Node.fromJSON(schema, JSON.parse(value));
    node.check();
    return node.type.name === 'doc';
  } catch {
    return false;
  }
};
