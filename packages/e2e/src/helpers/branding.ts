/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ApiUser } from './api.js';

// The platform brand is one record for the whole local stack, so a scenario
// that changes it puts back what it found.
export type Brand = Awaited<
  ReturnType<ApiUser['admin']['branding']['get']['query']>
>;

/** The brand and its revision as they are now. */
export const currentBrand = (admin: ApiUser): Promise<Brand> =>
  admin.admin.branding.get.query();

/**
 * Saves `captured` again, on whatever revision the brand is at now, so the
 * stack is as the scenario found it. (A brand that was never saved comes
 * back as the default brand, saved.)
 */
export const restoreBrand = async (admin: ApiUser, captured: Brand) => {
  const now = await currentBrand(admin);
  await admin.admin.branding.save.mutate({
    expectedRevision: now.revision,
    ...captured.brand,
  });
};

type UploadInput = Parameters<
  ApiUser['admin']['branding']['createUploadUrl']['mutate']
>[0];

/**
 * Uploads a brand image through the API, as the Branding page does, and returns
 * its key for a `branding.save`. For set-up that is not what a scenario checks.
 */
export const uploadBrandImage = async (
  admin: ApiUser,
  kind: UploadInput['kind'],
  contentType: UploadInput['contentType'],
  body: Buffer,
): Promise<string> => {
  const { key, uploadUrl, headers } =
    await admin.admin.branding.createUploadUrl.mutate({
      kind,
      contentType,
      contentLength: body.length,
    });
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(`Uploading the ${kind} failed (${response.status})`);
  }
  return key;
};
