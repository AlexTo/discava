/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BRAND_IMAGE_RULES,
  type BrandImageKind,
  checkBrandImage,
  checkBrandImageUpload,
} from '@discava/common-branding/image-rules';
import {
  getPublicMediaObjectBytes,
  headPublicMediaObject,
} from '@discava/common-server-utils/public-media';
import { XMLParser } from 'fast-xml-parser';
import { imageSize } from 'image-size';

// What the server checks of an uploaded brand image before it is saved (the
// admin portal checks the same rules first, for immediate feedback; this is
// the check that counts). The presigned upload already held the object to the
// type and length asked for, but a file's real type and shape, and anything
// an SVG could do, are only known by reading it.

/** The most any brand image can be, so a read never buffers more. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

export type BrandImageInspection =
  | { ok: true }
  | { ok: false; message: string };

const RASTER_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const fail = (message: string): BrandImageInspection => ({
  ok: false,
  message,
});

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  ignoreDeclaration: true,
  ignorePiTags: true,
  // Declared (and the five predefined) entities are expanded, so the rules
  // below see the values a browser will. Numeric character references are
  // decoded by decodeReferences.
  processEntities: true,
  trimValues: false,
});

type XmlNode = {
  [tag: string]: unknown;
  ':@'?: Record<string, string>;
};

// An element name without its namespace prefix, lower-cased.
const localName = (name: string): string =>
  (name.split(':').pop() ?? name).toLowerCase();

// Elements that can run code or load a page, or that are only editor data.
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
]);
const EDITOR_PREFIXES = ['sodipodi:', 'inkscape:'];
const IGNORED_ELEMENTS = new Set(['metadata']);

// Only an image a browser draws from the file itself: a same-document
// fragment, or an embedded PNG, JPEG or WebP.
const SAFE_REFERENCE = /^(#.*|data:image\/(png|jpeg|webp)[;,].*)$/is;

const unsafeUrl = (text: string): boolean => {
  for (const match of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gis)) {
    if (!SAFE_REFERENCE.test(match[2]?.trim() ?? '')) {
      return true;
    }
  }
  return /url\(/i.test(text.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gis, ''));
};

const checkAttributes = (
  tag: string,
  attributes: Record<string, string> | undefined,
): string | undefined => {
  for (const [name, rawValue] of Object.entries(attributes ?? {})) {
    const lower = name.toLowerCase();
    // A name is never written with a reference (XML forbids it), so one is an
    // attempt to hide what the name is from the rules.
    if (name.includes('&')) {
      return `a reference in an attribute name (${name})`;
    }
    const decoded = decodeReferences(String(rawValue));
    if (decoded === undefined) {
      return `a character reference that is not a character (${name})`;
    }
    const value = decoded;
    if (lower.startsWith('on')) {
      return `an event handler (${name})`;
    }
    if (lower === 'xmlns' || lower.startsWith('xmlns:')) {
      continue;
    }
    if (
      (lower === 'href' || lower.endsWith(':href')) &&
      !SAFE_REFERENCE.test(value.trim())
    ) {
      return `a link to ${value.trim().slice(0, 60)}`;
    }
    if (/@import/i.test(value) || unsafeUrl(value)) {
      return `a reference to something outside the file (${name})`;
    }
    if (
      ['animate', 'set', 'animatetransform', 'animatemotion'].includes(tag) &&
      lower === 'attributename' &&
      localName(value) === 'href'
    ) {
      return 'an animation that changes a link';
    }
  }
  return undefined;
};

const textOf = (children: unknown): string | undefined =>
  decodeReferences(
    (Array.isArray(children) ? children : [])
      .map((child) =>
        typeof child === 'object' && child !== null && '#text' in child
          ? String((child as Record<string, unknown>)['#text'])
          : '',
      )
      .join(''),
  );

const walk = (nodes: XmlNode[]): string | undefined => {
  for (const node of nodes) {
    const name = Object.keys(node).find((key) => key !== ':@');
    if (!name || name === '#text') {
      continue;
    }
    const lower = name.toLowerCase();
    const tag = localName(name);
    if (name.includes('&')) {
      return `a reference in an element name (${name})`;
    }
    if (
      IGNORED_ELEMENTS.has(tag) ||
      EDITOR_PREFIXES.some((prefix) => lower.startsWith(prefix))
    ) {
      continue;
    }
    if (FORBIDDEN_ELEMENTS.has(tag)) {
      return `a <${tag}> element`;
    }
    const attributeProblem = checkAttributes(tag, node[':@']);
    if (attributeProblem) {
      return attributeProblem;
    }
    if (tag === 'style') {
      const css = textOf(node[name]);
      if (css === undefined || /@import/i.test(css) || unsafeUrl(css)) {
        return 'a stylesheet that loads something from outside the file';
      }
    }
    const children = node[name];
    if (Array.isArray(children)) {
      const problem = walk(children as XmlNode[]);
      if (problem) {
        return problem;
      }
    }
  }
  return undefined;
};

const number = (value: string | undefined): number | undefined => {
  if (value === undefined || /%\s*$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** An SVG's size from its viewBox, else its width and height. */
const svgSize = (
  root: Record<string, string> | undefined,
): { width: number; height: number } | undefined => {
  const box = root?.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) {
    return { width: box[2]!, height: box[3]! };
  }
  const width = number(root?.width);
  const height = number(root?.height);
  return width && height ? { width, height } : undefined;
};

// Entity declarations in the file's own DTD. The parser leaves entities
// unexpanded, but a browser expands them into markup, so an entity that holds
// markup (or a character reference that makes it) would hide what the checks
// below look for. Illustrator's exports declare plain-text entities for
// namespace URLs, which are fine; anything that could build markup, a
// parameter entity or an external one is refused.
// What a browser does with the file's own DTD, which the rules below can't see
// through: it expands entities into the text and attributes that use them and
// applies `<!ATTLIST>` defaults. So the DTD may declare only plain-text
// entities (what Illustrator writes for its namespace URLs): short values with
// no markup and no references, nothing external, no parameter entities, and
// nothing else. Anything that doesn't match is refused, so a declaration
// written in an unexpected way can't get through.
const ENTITY_KEYWORD = /<!ENTITY/gi;
const PLAIN_ENTITY =
  /<!ENTITY\s+[^\s%&<>"']+\s+(?:"[^"<&]{0,200}"|'[^'<&]{0,200}')\s*>/gi;
const OTHER_DECLARATION =
  /<!(?:ATTLIST|ELEMENT|NOTATION)\b|<!\[(?:CDATA\[)?\s*(?:INCLUDE|IGNORE)/i;
const MAX_ENTITIES = 20;

const hasUnsafeDtd = (text: string): boolean => {
  const declared = text.match(ENTITY_KEYWORD)?.length ?? 0;
  const plain = text.match(PLAIN_ENTITY)?.length ?? 0;
  return (
    declared !== plain ||
    declared > MAX_ENTITIES ||
    OTHER_DECLARATION.test(text)
  );
};

// Numeric character references (`&#104;`, `&#x68;`), which the parser leaves
// as written but a browser turns into the character, so `&#104;ref` is
// `href`. Returns undefined for one that isn't a character.
const decodeReferences = (value: string): string | undefined => {
  let valid = true;
  const decoded = value.replace(
    /&#(?:(\d{1,7})|x([0-9a-f]{1,6}));/gi,
    (_match, decimal?: string, hex?: string) => {
      const code = decimal
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hex ?? '', 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        valid = false;
        return '';
      }
      return String.fromCodePoint(code);
    },
  );
  return valid ? decoded : undefined;
};

const inspectSvg = (
  label: string,
  text: string,
): { problem?: string; size?: { width: number; height: number } } => {
  if (hasUnsafeDtd(text)) {
    return {
      problem: `The ${label} can only declare plain-text entities: no markup, references, external files or other declarations in its DTD.`,
    };
  }
  let tree: XmlNode[];
  try {
    tree = parser.parse(text) as XmlNode[];
  } catch {
    return { problem: `The ${label} is not a valid SVG file.` };
  }
  const root = tree.find((node) => 'svg' in node);
  if (!root) {
    return { problem: `The ${label} is not a valid SVG file.` };
  }
  const found = walk(tree);
  if (found) {
    return {
      problem: `The ${label} can't contain ${found}: SVG logos may only draw shapes, text and images.`,
    };
  }
  const size = svgSize(root[':@']);
  return size
    ? { size }
    : { problem: `The ${label} has no size: give the SVG a viewBox.` };
};

/**
 * Reads the object at `key` and checks it against the rules for `kind`:
 * uploaded at all, the type and size allowed, the type the bytes really are,
 * and its shape. An SVG logo is also refused if it could run code or fetch
 * anything from outside the file.
 */
export const inspectBrandImage = async (
  kind: BrandImageKind,
  key: string,
): Promise<BrandImageInspection> => {
  const { label, description } = BRAND_IMAGE_RULES[kind];
  const head = await headPublicMediaObject(key);
  if (!head?.contentType) {
    return fail(
      `The ${label} was not uploaded. Choose the file again. It must be ${description}`,
    );
  }
  const upload = checkBrandImageUpload({
    kind,
    contentType: head.contentType,
    bytes: head.contentLength ?? 0,
  });
  if (!upload.ok) {
    return upload;
  }

  let bytes: Uint8Array | undefined;
  try {
    bytes = await getPublicMediaObjectBytes(key, MAX_READ_BYTES);
  } catch {
    return fail(`The ${label} is too large. It must be ${description}`);
  }
  if (!bytes) {
    return fail(`The ${label} was not uploaded. Choose the file again.`);
  }

  let size: { width: number; height: number } | undefined;
  if (head.contentType === 'image/svg+xml') {
    const svg = inspectSvg(label, new TextDecoder().decode(bytes));
    if (svg.problem) {
      return fail(svg.problem);
    }
    size = svg.size;
  } else {
    try {
      const detected = imageSize(bytes);
      if (detected.type !== RASTER_TYPES[head.contentType]) {
        return fail(
          `The ${label} is not really a ${RASTER_TYPES[head.contentType]?.toUpperCase()} file. It must be ${description}`,
        );
      }
      size = { width: detected.width, height: detected.height };
    } catch {
      return fail(
        `The ${label} could not be read as an image. It must be ${description}`,
      );
    }
  }
  return checkBrandImage({
    kind,
    contentType: head.contentType,
    bytes: bytes.length,
    width: size?.width ?? 0,
    height: size?.height ?? 0,
  });
};
