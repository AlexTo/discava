/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useRuntimeConfig } from './useRuntimeConfig';

/**
 * Turns a public media object key from the APIs (e.g. a course's `imageKey`)
 * into its URL, under the base URL the stack publishes in runtime-config.json.
 * Undefined for no key, or before the public media bucket is deployed.
 */
export const usePublicMediaUrl = (): ((
  key: string | undefined,
) => string | undefined) => {
  const base: string | undefined = useRuntimeConfig().media?.PublicMediaBucket;
  return (key) => (key && base ? new URL(key, base).toString() : undefined);
};
