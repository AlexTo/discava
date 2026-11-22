/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BrandFieldsSchema,
  DEFAULT_BRAND,
} from '@discava/common-branding/brand';
import {
  type BrandImageKind,
  brandImageExtension,
  brandImageKey,
  checkBrandImageUpload,
} from '@discava/common-branding/image-rules';
import {
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
  presignPublicMediaUpload,
} from '@discava/common-server-utils/public-media';
import {
  BrandConflictError,
  BrandValidationError,
  type CoreTable,
  getBrand,
  type PlatformBrandRecord,
  saveBrand,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { inspectBrandImage } from '../helpers/brand-image.js';
import { adminProcedure } from '../init.js';
import {
  BrandStateSchema,
  CreateBrandUploadUrlInputSchema,
  CreateBrandUploadUrlOutputSchema,
  SaveBrandInputSchema,
} from '../schema/index.js';

// The platform brand (#814): the admin's logo, icon, share image, name and
// colour. Images are uploaded straight to the public media bucket, then
// saved with the rest; uploads arrive tagged to expire and saving one keeps
// it, so an upload that's never saved cleans itself up.

const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const KEY_FIELDS = {
  logo: 'logoKey',
  icon: 'iconKey',
  'share-image': 'shareImageKey',
} as const satisfies Record<BrandImageKind, keyof PlatformBrandRecord>;

const CONFLICT_MESSAGE =
  'Someone else changed the branding. Reload to see their changes.';

const displayName = async (coreTable: CoreTable, userId: string) => {
  const { data } = await coreTable.entities.user.get({ userId }).go();
  const name = [data?.givenName, data?.familyName].filter(Boolean).join(' ');
  return name || 'An administrator';
};

const toState = (record: PlatformBrandRecord | undefined) => ({
  brand: {
    name: record?.name ?? null,
    showNameBesideLogo:
      record?.showNameBesideLogo ?? DEFAULT_BRAND.showNameBesideLogo,
    colour: record?.colour ?? null,
    logoKey: record?.logoKey ?? null,
    iconKey: record?.iconKey ?? null,
    shareImageKey: record?.shareImageKey ?? null,
  },
  revision: record?.revision ?? 0,
  changed: record
    ? {
        by: record.changedBy,
        byName: record.changedByName,
        at: record.changedAt,
      }
    : null,
});

export const getBranding = adminProcedure
  .output(BrandStateSchema)
  .query(async ({ ctx }) => toState(await getBrand(ctx.coreTable)));

export const createBrandUploadUrl = adminProcedure
  .input(CreateBrandUploadUrlInputSchema)
  .output(CreateBrandUploadUrlOutputSchema)
  .mutation(async ({ input }) => {
    const { kind, contentType, contentLength } = input;
    const allowed = checkBrandImageUpload({
      kind,
      contentType,
      bytes: contentLength,
    });
    if (!allowed.ok) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: allowed.message });
    }
    const key = brandImageKey(kind, uuidv7(), brandImageExtension(contentType));
    return {
      key,
      ...(await presignPublicMediaUpload({
        key,
        contentType,
        contentLength,
        cacheControl: IMAGE_CACHE_CONTROL,
      })),
    };
  });

export const saveBranding = adminProcedure
  .input(SaveBrandInputSchema)
  .output(BrandStateSchema)
  .mutation(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const { expectedRevision, ...fields } = input;

    // 1. The fields themselves.
    const parsed = BrandFieldsSchema.safeParse(fields);
    if (!parsed.success) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'The brand is not valid.',
      });
    }
    const brand = parsed.data;
    const current = await getBrand(coreTable);

    // 2. Every image that differs from the saved one, read and checked. Nothing
    // is written if any fails.
    const kinds = Object.keys(KEY_FIELDS) as BrandImageKind[];
    const added: string[] = [];
    const replaced: string[] = [];
    for (const kind of kinds) {
      const field = KEY_FIELDS[kind];
      const next = brand[field];
      const previous = current?.[field] ?? null;
      if (next === previous) {
        continue;
      }
      if (previous) {
        replaced.push(previous);
      }
      if (next) {
        const result = await inspectBrandImage(kind, next);
        if (!result.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.message });
        }
        added.push(next);
      }
    }

    // 3. Kept before the record points at them, so a saved image is never
    // one about to expire.
    await Promise.all(added.map((key) => attachPublicMediaObject(key)));

    // 4. The record, which wins only if nobody saved since it was read.
    let saved: PlatformBrandRecord;
    try {
      saved = await saveBrand(coreTable, {
        expectedRevision,
        changes: brand,
        changedBy: ctx.user.sub,
        changedByName: await displayName(coreTable, ctx.user.sub),
        now: new Date().toISOString(),
      });
    } catch (error) {
      await Promise.all(
        added.map((key) => bestEffortDetachPublicMediaObject(ctx.logger, key)),
      );
      if (error instanceof BrandConflictError) {
        throw new TRPCError({ code: 'CONFLICT', message: CONFLICT_MESSAGE });
      }
      if (error instanceof BrandValidationError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }

    // 5. What the save replaced or removed can expire.
    await Promise.all(
      replaced.map((key) => bestEffortDetachPublicMediaObject(ctx.logger, key)),
    );

    return toState(saved);
  });
