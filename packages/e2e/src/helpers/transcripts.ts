/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The local OpenSearch container's `transcripts` index (port from
// @discava/search's config.json), the one the transcript indexer writes.
const TRANSCRIPTS_INDEX = 'http://localhost:9200/transcripts';

/** How many passages of a content item the transcripts index holds. */
export const transcriptDocumentCount = async (
  contentItemId: string,
): Promise<number> => {
  const response = await fetch(`${TRANSCRIPTS_INDEX}/_count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { term: { contentItemId } } }),
  });
  if (!response.ok) {
    throw new Error(`Counting transcripts failed: ${response.status}`);
  }
  return ((await response.json()) as { count: number }).count;
};
