/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import coursesIndex from './courses.js';

// Every index the collection has, in one place: generate-indices-manifest.ts
// turns this into the manifest both local dev and CDK read, and client.ts's
// resolveIndexName validates against it. One index per document type (#53):
// mapping types were removed in OpenSearch 2.0, so content types never
// share an index.
export const INDICES = [coursesIndex] as const;

export * from './courses.js';
export * from './create-index.js';
export { coursesIndex };
