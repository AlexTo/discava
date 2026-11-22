/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { type BrandPalette, brandPalette, parseHex } from './colour.js';
import { DEFAULT_LOGO_URL } from './default-logo.js';
import { type BrandImageKind, isBrandImageKey } from './image-rules.js';

export const BRAND_NAME_MAX_LENGTH = 50;
export const DEFAULT_BRAND_NAME = 'Discava';

const imageKey = (kind: BrandImageKind, label: string) =>
  z
    .string()
    .refine((key) => isBrandImageKey(kind, key), {
      message: `The ${label} is not a valid brand image.`,
    })
    .nullable();

/**
 * The parts of the brand an admin sets. `null` means the default for that
 * part; `showNameBesideLogo` is on by default.
 */
export const BrandFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'The name must be 1–50 characters.')
    .max(BRAND_NAME_MAX_LENGTH, 'The name must be 1–50 characters.')
    .nullable(),
  showNameBesideLogo: z.boolean(),
  colour: z
    .string()
    .transform((value, ctx) => {
      const hex = parseHex(value);
      const palette = hex ? brandPalette(hex) : undefined;
      if (!hex || !palette?.ok) {
        ctx.addIssue({
          code: 'custom',
          message:
            palette && !palette.ok
              ? palette.reason
              : 'The colour must be a hex value like #1d4ed8.',
        });
        return z.NEVER;
      }
      return hex;
    })
    .nullable(),
  logoKey: imageKey('logo', 'logo'),
  iconKey: imageKey('icon', 'icon'),
  shareImageKey: imageKey('share-image', 'share image'),
});
export type BrandFields = z.infer<typeof BrandFieldsSchema>;

/** The published `brand/brand.json`: the fields and the record's revision. */
export const BrandDocumentSchema = BrandFieldsSchema.extend({
  revision: z.number().int().min(1),
});
export type BrandDocument = z.infer<typeof BrandDocumentSchema>;

/** The brand when nothing has been saved: the Discava name and logo. */
export const DEFAULT_BRAND = {
  name: DEFAULT_BRAND_NAME,
  logoUrl: DEFAULT_LOGO_URL,
  showNameBesideLogo: true,
  colour: null,
  logoKey: null,
  iconKey: null,
  shareImageKey: null,
} as const;

/** The brand with every part filled in, ready to render. */
export type ResolvedBrand = {
  name: string;
  showNameBesideLogo: boolean;
  logoUrl: string;
  iconUrl: string | null;
  shareImageUrl: string | null;
  palette: Extract<BrandPalette, { ok: true }> | null;
};

const mediaUrl = (
  key: string | null,
  mediaBaseUrl: string | undefined,
): string | null =>
  key && mediaBaseUrl ? new URL(key, mediaBaseUrl).toString() : null;

/**
 * The brand to render from the saved fields (or none), with image keys turned
 * into URLs under `mediaBaseUrl`. A part that is unset, or whose image can't
 * be located, is the default.
 */
export const resolveBrand = (
  fields: BrandFields | undefined,
  mediaBaseUrl: string | undefined,
): ResolvedBrand => {
  const palette = fields?.colour ? brandPalette(fields.colour) : undefined;
  return {
    name: fields?.name ?? DEFAULT_BRAND.name,
    showNameBesideLogo:
      fields?.showNameBesideLogo ?? DEFAULT_BRAND.showNameBesideLogo,
    logoUrl:
      mediaUrl(fields?.logoKey ?? null, mediaBaseUrl) ?? DEFAULT_BRAND.logoUrl,
    iconUrl: mediaUrl(fields?.iconKey ?? null, mediaBaseUrl),
    shareImageUrl: mediaUrl(fields?.shareImageKey ?? null, mediaBaseUrl),
    palette: palette?.ok ? palette : null,
  };
};
