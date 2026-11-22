/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export const BRAND_IMAGE_KINDS = ['logo', 'icon', 'share-image'] as const;
export type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number];

export const BRAND_IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;
export type BrandImageContentType = (typeof BRAND_IMAGE_CONTENT_TYPES)[number];

const EXTENSIONS: Record<BrandImageContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const MB = 1024 * 1024;

type KindRules = {
  /** What the admin sees: "logo". */
  label: string;
  contentTypes: readonly BrandImageContentType[];
  /** The rule as one sentence, shown beside the upload control. */
  description: string;
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  /** Width ÷ height, inclusive. */
  minRatio: number;
  maxRatio: number;
};

export const BRAND_IMAGE_RULES: Record<BrandImageKind, KindRules> = {
  logo: {
    label: 'logo',
    contentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    description:
      'PNG, JPEG, WebP or SVG, up to 1 MB, width ÷ height from 1 to 4.',
    maxBytes: 1 * MB,
    minWidth: 1,
    minHeight: 1,
    minRatio: 1,
    maxRatio: 4,
  },
  icon: {
    label: 'icon',
    contentTypes: ['image/png'],
    description: 'PNG, up to 1 MB, square, at least 192 × 192.',
    maxBytes: 1 * MB,
    minWidth: 192,
    minHeight: 192,
    minRatio: 1,
    maxRatio: 1,
  },
  'share-image': {
    label: 'share image',
    contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
    description:
      'PNG, JPEG or WebP, up to 2 MB, at least 1200 × 630, width ÷ height from 1.8 to 2.',
    maxBytes: 2 * MB,
    minWidth: 1200,
    minHeight: 630,
    minRatio: 1.8,
    maxRatio: 2,
  },
};

const TYPE_NAMES: Record<BrandImageContentType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
};

export const isBrandImageKind = (value: string): value is BrandImageKind =>
  (BRAND_IMAGE_KINDS as readonly string[]).includes(value);

/** The file extension a brand image of this content type is stored with. */
export const brandImageExtension = (
  contentType: BrandImageContentType,
): string => EXTENSIONS[contentType];

// Lower-cases the description's first word to continue the sentence, unless
// it's an acronym such as "PNG".
const continuing = (text: string): string =>
  /^[A-Z][A-Z]/.test(text)
    ? text
    : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

const sentence = (kind: BrandImageKind): string => {
  const { label, description } = BRAND_IMAGE_RULES[kind];
  return `The ${label} must be ${continuing(description)}`;
};

/**
 * Whether an image of this type and length may be uploaded for `kind`: the
 * part of the rules known before the file is read.
 */
export const checkBrandImageUpload = (input: {
  kind: BrandImageKind;
  contentType: string;
  bytes: number;
}): { ok: true } | { ok: false; message: string } => {
  const rules = BRAND_IMAGE_RULES[input.kind];
  if (!(rules.contentTypes as readonly string[]).includes(input.contentType)) {
    const names = rules.contentTypes.map((type) => TYPE_NAMES[type]);
    return {
      ok: false,
      message: `The ${rules.label} must be a ${names.join(', ').replace(/, ([^,]*)$/, ' or $1')} file. ${sentence(input.kind)}`,
    };
  }
  if (input.bytes > rules.maxBytes) {
    return {
      ok: false,
      message: `The ${rules.label} is too large. ${sentence(input.kind)}`,
    };
  }
  return { ok: true };
};

/**
 * Checks an image against its kind's rules, returning a message naming the
 * rule broken. The API and the admin portal show it verbatim.
 */
export const checkBrandImage = (input: {
  kind: BrandImageKind;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
}): { ok: true } | { ok: false; message: string } => {
  const upload = checkBrandImageUpload(input);
  if (!upload.ok) {
    return upload;
  }
  const rules = BRAND_IMAGE_RULES[input.kind];
  const { width, height } = input;
  if (!(width > 0) || !(height > 0)) {
    return {
      ok: false,
      message: `The ${rules.label} has no readable size. ${sentence(input.kind)}`,
    };
  }
  if (width < rules.minWidth || height < rules.minHeight) {
    return {
      ok: false,
      message: `The ${rules.label} is ${width} × ${height}, which is too small. ${sentence(input.kind)}`,
    };
  }
  const ratio = width / height;
  // A small tolerance so a rounded size such as 1200 × 600 isn't refused for
  // floating point.
  if (ratio < rules.minRatio - 1e-9 || ratio > rules.maxRatio + 1e-9) {
    return {
      ok: false,
      message: `The ${rules.label} is ${width} × ${height}, which has the wrong shape. ${sentence(input.kind)}`,
    };
  }
  return { ok: true };
};

const NONCE = '[0-9a-f-]{36}';

/** Where a brand image is stored: `brand/{kind}/{nonce}.{ext}`. */
export const brandImageKey = (
  kind: BrandImageKind,
  nonce: string,
  ext: string,
): string => `brand/${kind}/${nonce}.${ext}`;

/** Whether `key` is a brand image key of `kind`, as brandImageKey makes. */
export const isBrandImageKey = (kind: BrandImageKind, key: string): boolean => {
  const extensions = [
    ...new Set(
      BRAND_IMAGE_RULES[kind].contentTypes.map((type) => EXTENSIONS[type]),
    ),
  ];
  return new RegExp(
    `^brand/${kind}/${NONCE}\\.(${extensions.join('|')})$`,
  ).test(key);
};
