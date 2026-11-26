/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { DEFAULT_BRAND } from '@discava/common-branding/brand';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrandToDocument,
  BRAND_WAIT_MS,
  BrandProvider,
  forgetEmbeddedBrand,
  useBrand,
  useSetBrand,
} from './brand';
import { RuntimeConfigContext } from './runtime-config';

const MEDIA = 'https://media.test/';
const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';

const acme = {
  revision: 3,
  name: 'Acme Academy',
  showNameBesideLogo: true,
  colour: '#1d4ed8',
  logoKey: `brand/logo/${NONCE}.svg`,
  iconKey: `brand/icon/${NONCE}.png`,
  shareImageKey: null,
};
const globex = { ...acme, revision: 4, name: 'Globex', colour: null };

const Show = () => {
  const brand = useBrand();
  return (
    <p>
      name:{brand.name}|logo:{brand.logoUrl.slice(0, 40)}
    </p>
  );
};

const renderBrand = (
  props: Parameters<typeof BrandProvider>[0] = {},
  media: string | undefined = MEDIA,
) =>
  render(
    <RuntimeConfigContext.Provider
      value={media ? { media: { PublicMediaBucket: media } } : {}}
    >
      <BrandProvider fallback={<p>waiting</p>} {...props}>
        <Show />
      </BrandProvider>
    </RuntimeConfigContext.Provider>,
  );

const serve = (answer: () => Promise<Response>) => {
  const fetchMock = vi.fn<typeof fetch>(answer);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  document.head.innerHTML = `
    <meta name="theme-color" content="#ffffff" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />`;
  document.body.innerHTML = '';
  document.title = '';
  root().removeAttribute('style');
  forgetEmbeddedBrand();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('BrandProvider start-up', () => {
  it('holds the render until brand.json arrives on a first visit', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = serve(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    renderBrand();
    expect(screen.getByText('waiting')).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://media.test/brand/brand.json',
    );
    await act(async () => {
      release(new Response(JSON.stringify(acme)));
    });
    await screen.findByText(/name:Acme Academy/);
    expect(document.title).toBe('Acme Academy');
  });

  it('renders the defaults after 1 s when brand.json has not arrived', async () => {
    vi.useFakeTimers();
    serve(() => new Promise<Response>(() => {}));
    renderBrand();
    expect(screen.getByText('waiting')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BRAND_WAIT_MS);
    });
    expect(screen.getByText(/name:Discava/)).toBeTruthy();
  });

  it('renders at once from the last brand in localStorage, then refreshes', async () => {
    window.localStorage.setItem('discava.brand', JSON.stringify(acme));
    let release: (response: Response) => void = () => {};
    serve(() => new Promise<Response>((resolve) => (release = resolve)));
    renderBrand();
    expect(screen.getByText(/name:Acme Academy/)).toBeTruthy();
    await act(async () => {
      release(new Response(JSON.stringify(globex)));
    });
    await screen.findByText(/name:Globex/);
    expect(
      JSON.parse(window.localStorage.getItem('discava.brand') ?? '{}').name,
    ).toBe('Globex');
  });

  it('renders at once from the brand the page renderer embedded', async () => {
    const data = document.createElement('script');
    data.id = 'discava-page-data';
    data.type = 'application/json';
    data.textContent = JSON.stringify({ brand: acme });
    document.body.appendChild(data);
    window.localStorage.setItem('discava.brand', JSON.stringify(globex));
    serve(() => new Promise<Response>(() => {}));
    renderBrand();
    expect(screen.getByText(/name:Acme Academy/)).toBeTruthy();
    // The student portal removes the element when it seeds its cache; the
    // brand was read before that, and is still there for a later reader.
    data.remove();
    renderBrand();
    expect(screen.getAllByText(/name:Acme Academy/)).toHaveLength(2);
  });

  it('uses the defaults, and does not fetch, with no media base', () => {
    const fetchMock = serve(() => json(acme));
    renderBrand({}, '');
    expect(screen.getByText(/name:Discava/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the defaults on a 404 and forgets a stored brand', async () => {
    window.localStorage.setItem('discava.brand', JSON.stringify(acme));
    serve(() => Promise.resolve(new Response('', { status: 404 })));
    renderBrand();
    await screen.findByText(/name:Discava/);
    expect(window.localStorage.getItem('discava.brand')).toBeNull();
  });

  it('shows the defaults on a network error and a document that fails the schema', async () => {
    serve(() => Promise.reject(new Error('offline')));
    const { unmount } = renderBrand();
    await screen.findByText(/name:Discava/);
    unmount();

    serve(() => json({ ...acme, colour: '#777777' }));
    renderBrand();
    await screen.findByText(/name:Discava/);
    expect(window.localStorage.getItem('discava.brand')).toBeNull();
  });

  it('keeps the stored brand when the refresh is a bad document', async () => {
    window.localStorage.setItem('discava.brand', JSON.stringify(acme));
    const fetchMock = serve(() => json({ nonsense: true }));
    renderBrand();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByText(/name:Acme Academy/)).toBeTruthy();
  });
});

describe('BrandProvider updates', () => {
  it('lets override win over the fetched brand', async () => {
    serve(() => json(globex));
    renderBrand({ override: acme });
    await screen.findByText(/name:Acme Academy/);
    await act(async () => {});
    expect(screen.getByText(/name:Acme Academy/)).toBeTruthy();
  });

  it('shows a brand set with useSetBrand at once', async () => {
    serve(() => json(globex));
    const Setter = () => {
      const set = useSetBrand();
      return (
        <button type="button" onClick={() => set(acme)}>
          save
        </button>
      );
    };
    render(
      <RuntimeConfigContext.Provider
        value={{ media: { PublicMediaBucket: MEDIA } }}
      >
        <BrandProvider>
          <Show />
          <Setter />
        </BrandProvider>
      </RuntimeConfigContext.Provider>,
    );
    await screen.findByText(/name:Globex/);
    await act(async () => screen.getByText('save').click());
    expect(screen.getByText(/name:Acme Academy/)).toBeTruthy();
  });
});

describe('applyBrandToDocument', () => {
  const resolved = (fields: Partial<typeof acme> | null) =>
    // Imported lazily to keep the test's imports to what it asserts on.
    import('@discava/common-branding/brand').then(({ resolveBrand }) =>
      resolveBrand(fields ? { ...acme, ...fields } : undefined, MEDIA),
    );

  it('sets the palette variables, icons, theme colour and title', async () => {
    applyBrandToDocument(await resolved({}));
    expect(root().style.getPropertyValue('--primary')).toBe('#1d4ed8');
    expect(root().style.getPropertyValue('--brand-link')).toBe('#1d4ed8');
    expect(
      document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href,
    ).toBe(`${MEDIA}brand/icon/${NONCE}.png`);
    expect(
      document.head
        .querySelector('link[rel="apple-touch-icon"]')
        ?.getAttribute('href'),
    ).toBe(`${MEDIA}brand/icon/${NONCE}.png`);
    expect(
      document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe('#1d4ed8');
    expect(document.title).toBe('Acme Academy');
  });

  it('removes the variables, the touch icon and the theme colour when they are reset', async () => {
    const custom = await resolved({});
    applyBrandToDocument(custom);
    applyBrandToDocument(await resolved(null), custom);
    expect(root().style.getPropertyValue('--primary')).toBe('');
    expect(root().style.getPropertyValue('--brand-link')).toBe('');
    expect(
      document.head.querySelector('link[rel="icon"]')?.getAttribute('href'),
    ).toBe('/favicon.ico');
    expect(
      document.head.querySelector('link[rel="apple-touch-icon"]'),
    ).toBeNull();
    expect(
      document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe('#ffffff');
    expect(document.title).toBe(DEFAULT_BRAND.name);
  });

  it('puts the new name on a page title that ends with the old one', async () => {
    const first = await resolved({});
    applyBrandToDocument(first);
    document.title = `Courses · ${first.name}`;
    applyBrandToDocument(await resolved({ name: 'Globex' }), first);
    expect(document.title).toBe('Courses · Globex');
  });

  it('leaves a title that is not the brand’s alone', async () => {
    const first = await resolved({});
    document.title = 'Something else';
    applyBrandToDocument(first);
    expect(document.title).toBe('Something else');
  });
});
