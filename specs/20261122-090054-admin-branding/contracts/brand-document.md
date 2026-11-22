# Contract: published brand document and where the brand is rendered

## `brand/brand.json`

Served by the public media distribution at `<media base>/brand/brand.json`, where the media base is `media.PublicMediaBucket` in each portal's `runtime-config.json` (set by the `PublicBucket` construct under the `connection` namespace; deployed: the distribution's domain; local: `http://localhost:9090/discava-public-media/` from each portal's `local-dev-config.ts`). The page renderer gets the same base from its `/<stage>/page-renderer` parameter (`publicMediaBaseUrl`).

Headers: `Content-Type: application/json`, `Cache-Control: public, max-age=60, s-maxage=240`, CORS `Access-Control-Allow-Origin: *` for `GET`/`HEAD` (research R-3, R-4).

Body (`BrandDocumentSchema` in `@discava/common-branding/brand`):

```json
{
  "revision": 7,
  "name": "Acme Academy",
  "showNameBesideLogo": false,
  "colour": "#1d4ed8",
  "logoKey": "brand/logo/01JD3….svg",
  "iconKey": "brand/icon/01JD3….png",
  "shareImageKey": null
}
```

Fields mean the same as in `branding.get` (nullable = default). Keys are resolved against the media base by the client. Readers MUST ignore unknown fields and MUST fall back to `DEFAULT_BRAND` if the document is missing (404 before the first save), unreadable or fails the schema.

Writer: only the `brand-publishing` handler, from the current `platformBrand` record. Idempotent: publishing the same record twice writes the same bytes.

## Portals (`BrandProvider`, `@discava/common-web-utils/brand`)

Exposes `useBrand(): ResolvedBrand`, where `ResolvedBrand` has every field filled in (`name`, `showNameBesideLogo`, `logoUrl`, `iconUrl | null`, `shareImageUrl | null`, `palette | null`). Sources and start-up order are in research R-9. Applies to the document:

| Brand part | Applied as |
|------------|------------|
| name | `document.title` (`<name>` or `<page> · <name>`, through `pageTitle` / `usePageTitle`), logo `alt`, header text |
| icon | `<link rel="icon" type="image/png">` and `<link rel="apple-touch-icon">`; when absent, the portal's own `favicon.ico` |
| colour | `brandPalette(colour)` CSS variables on `document.documentElement`; `<meta name="theme-color">` |

## Page renderer (student portal public pages)

For every page it renders (`/learn/*`, `/instructors/*`, `/certificates/*`, not found):

| Brand part | Rendered as |
|------------|-------------|
| name | `<title>… \| <name></title>`, `og:site_name`, JSON-LD provider name, the texts that use the site name today |
| share image | `og:image` and `twitter:image` when the page has no image of its own; else `/og-default.png` |
| icon | `<link rel="icon">` and `<link rel="apple-touch-icon">`, replacing the template's |
| colour | `<style>:root{…}</style>` with `brandPalette` variables; `<meta name="theme-color">` |
| whole brand | the brand document embedded in `#discava-page-data` as `brand`, which `BrandProvider` starts from |

Cache headers are unchanged (`s-maxage=300` for pages, 60 for not found).
