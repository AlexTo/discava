/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BrandDocumentSchema,
  type BrandFields,
  type ResolvedBrand,
  resolveBrand,
} from '@discava/common-branding/brand';
import { BRAND_VARIABLES } from '@discava/common-branding/colour';
import {
  createContext,
  createElement,
  type FC,
  Fragment,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRuntimeConfig } from './runtime-config';

// The platform brand in the portals: BrandProvider fetches the published
// `brand/brand.json`, keeps the last one it saw, and applies it to the
// document; useBrand gives components the resolved brand.

const PAGE_DATA_ID = 'discava-page-data';
const STORAGE_KEY = 'discava.brand';
const BRAND_DOCUMENT_PATH = 'brand/brand.json';
/** How long a first visit waits for brand.json before showing the defaults. */
export const BRAND_WAIT_MS = 1000;
const DEFAULT_ICON = '/favicon.ico';

const DEFAULT_RESOLVED = resolveBrand(undefined, undefined);

const BrandContext = createContext<ResolvedBrand>(DEFAULT_RESOLVED);
const SetBrandContext = createContext<(brand: BrandFields | undefined) => void>(
  () => {},
);

/** The brand to render: the default one outside a BrandProvider. */
export const useBrand = (): ResolvedBrand => useContext(BrandContext);

/**
 * Replaces the brand now, for the admin portal after a save, so the admin sees
 * it before the published copy's cache expires. Pass undefined to go back to
 * the default brand.
 */
export const useSetBrand = (): ((brand: BrandFields | undefined) => void) =>
  useContext(SetBrandContext);

/** Provides `brand` to useBrand, for tests of components that show it. */
export const BrandContextProvider = BrandContext.Provider;

const parseDocument = (value: unknown): BrandFields | undefined => {
  const parsed = BrandDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

let embedded: { brand: BrandFields | undefined } | undefined;

/**
 * The brand the page renderer put in `#discava-page-data`, if any. Read once
 * and remembered, because the student portal removes the element when it
 * seeds its query cache (before the first render).
 */
export const readEmbeddedBrand = (): BrandFields | undefined => {
  if (embedded) {
    return embedded.brand;
  }
  const element = document.getElementById(PAGE_DATA_ID);
  if (!element) {
    return undefined;
  }
  try {
    const data: unknown = JSON.parse(element.textContent ?? '');
    embedded = {
      brand:
        typeof data === 'object' && data !== null && 'brand' in data
          ? parseDocument((data as { brand: unknown }).brand)
          : undefined,
    };
  } catch {
    embedded = { brand: undefined };
  }
  return embedded.brand;
};

/** Forgets what readEmbeddedBrand remembered. For tests. */
export const forgetEmbeddedBrand = (): void => {
  embedded = undefined;
};

const readStored = (): BrandFields | undefined => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseDocument(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
};

const store = (document_: unknown | undefined): void => {
  try {
    if (document_) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document_));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage may be full or blocked; the brand is just fetched next time.
  }
};

const head = (selector: string): HTMLElement | null =>
  document.head.querySelector(selector);

// Gets or makes the one `<link rel=...>` of a kind.
const linkOf = (rel: string): HTMLLinkElement => {
  const existing = head(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (existing) {
    return existing;
  }
  const link = document.createElement('link');
  link.rel = rel;
  document.head.appendChild(link);
  return link;
};

// What the page had before a brand colour set the theme colour, to put back.
const THEME_COLOUR_ORIGINAL = 'data-brand-original';

/**
 * Applies the brand to the page: the palette's CSS variables (removed when
 * there is no brand colour), the tab icon and touch icon, the theme colour
 * and the title. `previous` is the brand applied before, so a title that
 * ends with its name ("Courses · Acme") gets the new name instead.
 */
export const applyBrandToDocument = (
  brand: ResolvedBrand,
  previous?: ResolvedBrand,
): void => {
  const root = document.documentElement;
  for (const name of BRAND_VARIABLES) {
    root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(brand.palette?.variables ?? {})) {
    root.style.setProperty(name, value);
  }

  const icon = linkOf('icon');
  if (brand.iconUrl) {
    icon.type = 'image/png';
    icon.href = brand.iconUrl;
  } else {
    icon.type = 'image/x-icon';
    icon.href = DEFAULT_ICON;
  }
  const touch = head('link[rel="apple-touch-icon"]');
  if (brand.iconUrl) {
    (touch ?? linkOf('apple-touch-icon')).setAttribute('href', brand.iconUrl);
  } else {
    touch?.remove();
  }

  const theme = head('meta[name="theme-color"]') as HTMLMetaElement | null;
  const primary = brand.palette?.variables['--primary'];
  if (primary) {
    const meta = theme ?? document.createElement('meta');
    if (!theme) {
      meta.name = 'theme-color';
      meta.setAttribute(THEME_COLOUR_ORIGINAL, '');
      document.head.appendChild(meta);
    } else if (!meta.hasAttribute(THEME_COLOUR_ORIGINAL)) {
      meta.setAttribute(THEME_COLOUR_ORIGINAL, meta.content);
    }
    meta.content = primary;
  } else if (theme?.hasAttribute(THEME_COLOUR_ORIGINAL)) {
    const original = theme.getAttribute(THEME_COLOUR_ORIGINAL);
    if (original) {
      theme.content = original;
      theme.removeAttribute(THEME_COLOUR_ORIGINAL);
    } else {
      theme.remove();
    }
  }

  const old = previous?.name;
  const title = document.title;
  if (!title || title === old) {
    document.title = brand.name;
  } else if (old && title.endsWith(` · ${old}`)) {
    document.title = `${title.slice(0, -old.length)}${brand.name}`;
  }
};

export interface BrandProviderProps extends PropsWithChildren {
  /**
   * A brand that wins over the published one: the admin portal's own copy
   * from `branding.get`, which is current even while the published copy is
   * cached.
   */
  override?: BrandFields;
  /** Shown while a first visit waits for the published brand. */
  fallback?: ReactNode;
}

type Fetched = { fields: BrandFields | undefined; document?: unknown };

// The published brand: the fields, or undefined when there is none yet (404).
// Throws when it can't be had, so the caller keeps what it has.
const fetchBrand = async (mediaBase: string): Promise<Fetched> => {
  const response = await fetch(new URL(BRAND_DOCUMENT_PATH, mediaBase));
  if (response.status === 404) {
    return { fields: undefined };
  }
  if (!response.ok) {
    throw new Error(`brand.json answered ${response.status}`);
  }
  const document_: unknown = await response.json();
  const fields = parseDocument(document_);
  if (!fields) {
    throw new Error('brand.json is not a brand document');
  }
  return { fields, document: document_ };
};

/**
 * Provides the platform brand. Starts from the brand the page renderer
 * embedded, else the last one seen (localStorage), and with one renders at
 * once and refreshes in the background; with neither it waits up to
 * BRAND_WAIT_MS for brand.json, then shows the default brand. Must sit inside
 * RuntimeConfigProvider: the media base comes from its config.
 */
export const BrandProvider: FC<BrandProviderProps> = ({
  override,
  fallback = null,
  children,
}) => {
  const mediaBase: string | undefined =
    useRuntimeConfig().media?.PublicMediaBucket;

  const [initial] = useState(() =>
    mediaBase ? (readEmbeddedBrand() ?? readStored()) : undefined,
  );
  const [fetched, setFetched] = useState<BrandFields | undefined>(initial);
  const [explicit, setExplicit] = useState<{
    brand: BrandFields | undefined;
  }>();
  // Rendering starts at once when there's a brand to show or nothing to fetch.
  const [ready, setReady] = useState(initial !== undefined || !mediaBase);

  useEffect(() => {
    if (!mediaBase) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setReady(true);
      }
    }, BRAND_WAIT_MS);
    fetchBrand(mediaBase).then(
      (result) => {
        if (cancelled) {
          return;
        }
        store(result.document);
        setFetched(result.fields);
        setReady(true);
      },
      () => {
        // Offline or a bad document: keep what there is (the defaults if
        // nothing), and let the page render.
        if (!cancelled) {
          setReady(true);
        }
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mediaBase]);

  // A new override from the server supersedes what the last save set.
  useEffect(() => {
    setExplicit(undefined);
  }, [override]);

  const setBrand = useCallback(
    (brand: BrandFields | undefined) => setExplicit({ brand }),
    [],
  );

  const fields = explicit ? explicit.brand : (override ?? fetched);
  const resolved = useMemo(
    () => resolveBrand(fields, mediaBase),
    [fields, mediaBase],
  );

  const applied = useRef<ResolvedBrand | undefined>(undefined);
  useEffect(() => {
    if (!ready) {
      return;
    }
    applyBrandToDocument(resolved, applied.current);
    applied.current = resolved;
  }, [ready, resolved]);

  return createElement(
    SetBrandContext.Provider,
    { value: setBrand },
    createElement(
      BrandContext.Provider,
      { value: resolved },
      ready ? children : createElement(Fragment, null, fallback),
    ),
  );
};

export default BrandProvider;
