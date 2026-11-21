# Research: Admin-Set Platform Branding

Each entry gives the decision, why, and what else was weighed. Code references are to `main` at the time of planning.

## R-1: Where the brand is stored

**Decision**: one singleton ElectroDB entity, `platformBrand`, in the core table, with a constant key (`pk` and `sk` composites both empty), shaped like `paymentConnection` (`core-table/src/entities/payment-connection.ts`). Absent until the first save; absent means "all defaults". Written only through `helpers/platform-brand.ts`.

**Rationale**: constitution V puts all application data in the one table. `paymentConnection` is the existing precedent for a platform-wide record an admin edits, with a `revision` counter and `changedBy` / `changedAt` fields, which are exactly what FR-012 and FR-013 need.

**Alternatives considered**:
- *Stage config in `common/infra-config`* (as the payout settings are): needs a redeploy, which the spec rules out (SC-001).
- *AWS AppConfig or SSM Parameter Store*: a second store for application data, and no local stand-in in `pnpm dev` today (constitution III).
- *A JSON file in S3 as the source of truth*: no conditional write on a revision without extra machinery; the table already gives it.

## R-2: Optimistic concurrency

**Decision**: `revision: number`, `1` on create, `+1` on every save. `saveBrand` takes the revision the admin loaded (`0` when no record exists): with `0` it creates the record conditioned on it not existing; otherwise it patches with `where revision = expected`. A failed condition throws `BrandConflictError`, which admin-api maps to `CONFLICT`.

**Rationale**: the same pattern as `paymentConnection` and the `version` checks in `instructor-profile.ts`, `announcement.ts` and others. The admin form always saves the whole brand, so a stale save can never half-apply (spec edge case "two admins edit at once").

## R-3: How visitors' browsers get the brand

**Decision**: a published brand document, `brand/brand.json`, in the existing public media bucket, served by its CloudFront distribution. The portals fetch it when they start; the page renderer reads the table directly (R-6). The document is written by a new feature registered with the core table's stream router, `brand-publishing`, whose handler reads the **current** `platformBrand` record (never the stream image, so out-of-order delivery cannot publish an older revision) and puts the document with `Cache-Control: public, max-age=60, s-maxage=240`.

**Rationale**:
- `runtime-config.json` is written at deploy time by CDK (`static-website.ts`), so it cannot carry a brand an admin changes at run time.
- A public core-api query would be a Lambda invocation and a table read on every page load of every visitor, uncached. A CDN-cached JSON costs nothing per visitor and works signed out.
- A browser holds the document for at most 60 s and CloudFront for at most 240 s, so a change reaches every new page load within 5 minutes (SC-002, FR-020), within the 300 s the page renderer already uses.
- Publishing through the stream router gives retries, a failure queue and an alarm for free, and runs locally through the event runner (constitution III). It keeps S3 out of the admin's save request, so a save never half-succeeds ("saved but not published").

**Alternatives considered**:
- *Publish synchronously in `branding.save`*: a failed put after a successful table write leaves the two out of step with no retry.
- *Serve `/brand/*` from each portal's own distribution, with the media bucket as a second origin*: same-origin, so no CORS, but it adds a cross-stack origin to three distributions and doubles the cache layers. Kept as the fallback if R-4's CORS approach does not work under S3Mock.
- *Bake the brand into each portal's `index.html` on save*: rewriting deploy artifacts at run time fights the next deploy.

## R-4: CORS and headers for `brand/*`

**Decision**: the `PublicMediaBucket` construct gains a `brand/*` behavior on its distribution with a response headers policy that:
- adds CORS for `GET` and `HEAD` from any origin (the document and images are public), so the portals can `fetch` `brand.json`;
- adds `Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox` and `X-Content-Type-Options: nosniff`, so a brand SVG opened directly cannot run anything (defence in depth for FR-006, R-8).

The behavior uses `CachingOptimized`, which honours the origin's `Cache-Control`. Locally, the portals fetch from S3Mock (`http://localhost:9090/discava-public-media/brand/brand.json`). One task checks that S3Mock answers a cross-origin `GET` with an `Access-Control-Allow-Origin` header; if it does not, local dev uses a Vite proxy for `/brand` instead and the deployed path is unchanged.

## R-5: Brand image storage and upload

**Decision**: reuse the public media bucket and its upload pattern (`instructor-api` course image and profile photo):
- keys `brand/{kind}/{nonce}.{ext}`, where `kind` is `logo`, `icon` or `share-image`, a new nonce per upload, so every URL is immutable and can be cached for a year;
- `branding.createUploadUrl` presigns a `PUT` with the exact `Content-Type`, `Content-Length`, `Cache-Control: public, max-age=31536000, immutable` and `Tagging: lifecycle=unattached`;
- `branding.save` validates the new object, removes the tag (attach), writes the record, then puts the tag back on the replaced object (best-effort detach); the bucket's existing lifecycle rule deletes unattached objects after a day.

`presignJpegUpload`, `headPublicMediaObject`, `attachPublicMediaObject` and `bestEffortDetachPublicMediaObject` live in `instructor-api/src/helpers/public-media-client.ts` today. With admin-api as a second consumer they move to `common-server-utils/public-media` (constitution VIII), and the presign helper takes the content type and cache control instead of assuming JPEG.

**Rationale**: no new bucket, distribution or cleanup job. The nonce key solves the "replaced image" edge case: a new logo is a new URL, so no browser or CDN can serve the old one once `brand.json` points elsewhere.

## R-6: The page renderer

**Decision**: the renderer reads `platformBrand` through `getBrand` on each render (one key read; the rendered page is cached 300 s by CloudFront, so reads are bounded by pages × 12 per hour) and uses it for:
- the title suffix, `og:site_name`, JSON-LD provider name and the certificate and profile texts that use `siteName` today;
- `og:image` / `twitter:image` fallback (the share image, else the student portal's `og-default.png`);
- `<link rel="icon">`, `<link rel="apple-touch-icon">` and `<meta name="theme-color">`, replacing the template's;
- an inline `<style>` setting the brand's CSS variables (R-7), so the server-rendered page shows the brand colour before any script runs;
- the brand document embedded in the page data, so the student portal's brand provider starts from it instead of fetching (no flash on a renderer page).

A failed read logs a warning and renders with the default brand (SC-005).

The stage setting `studentPortal.pageRenderer.siteName`, the `SITE_NAME` environment variable and the runtime-config `site.name` are removed, not kept as a fallback (constitution VII): the default name is a constant in `@discava/common-branding`, and the two student portal consumers of `useRuntimeConfig().site` read the brand instead.

## R-7: Applying the brand colour

**Decision**: one pure helper, `brandPalette(hex)` in `@discava/common-branding/colour`, returns the CSS variables to override in the shared theme (`common-shadcn/src/styles/globals.css`): `--primary`, `--primary-foreground`, `--ring`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-ring`, plus a new `--brand-link`. The portals set them on `document.documentElement`; the renderer writes them into a `:root { … }` rule. With no brand colour nothing is overridden and the neutral theme stays.

- **Text on the brand colour**: compute the WCAG 2.x relative luminance of the brand colour and its contrast against the theme's two text colours (`--primary-foreground`, near-white, and `--foreground`, near-black); choose whichever is higher; refuse the colour if neither reaches 4.5:1 (FR-009). Against pure white and pure black every colour would pass (the worst case is about 4.58:1), but against the theme's slightly softer text colours a narrow band of mid-luminance colours (relative luminance about 0.173 to 0.189, such as `#777777`, which reaches only 4.29:1 and 4.42:1) falls short. The admin page says so and suggests a darker or lighter shade.
- **Links**: links use `--brand-link`, which is the brand colour when it reaches 4.5:1 against the page background, and the default foreground otherwise. A pale brand colour (yellow, light cyan) would otherwise make every link unreadable on white. This narrows FR-018; the spec is amended in this PR.
- **Meaning colours** (`--destructive`, chart and status colours) are not touched.
- `--accent` in shadcn is a neutral hover background, not a brand accent, so it stays.

The same helper runs in admin-api (to refuse a colour), in the admin portal preview, in the portals and in the renderer, so they cannot disagree.

## R-8: Validating brand images, including SVG

**Decision**: `branding.save` reads each newly referenced object (at most 2 MB) and checks it against the per-kind rules in `@discava/common-branding/image-rules`:

| Kind | Types | Max size | Shape |
|------|-------|----------|-------|
| logo | PNG, JPEG, WebP, SVG | 1 MB | width ÷ height from 1 to 4 |
| icon | PNG | 1 MB | square, at least 192 × 192 |
| share image | PNG, JPEG, WebP | 2 MB | at least 1200 × 630, width ÷ height from 1.8 to 2 |

- Raster dimensions come from the file header via the `image-size` package (pure JavaScript, no native code, so the Lambda bundle stays simple). The detected type must match the declared `Content-Type`.
- An SVG logo is parsed with `fast-xml-parser` and refused unless every element and attribute is on an allow-list: no `script`, `foreignObject`, `iframe`, `animate*`/`set` on `href`, event-handler (`on*`) attributes, or `href`/`xlink:href`/`url(...)` other than a same-document `#fragment`; no `<style>` containing `@import` or `url(` to anything but a fragment. Its size comes from `viewBox`, else `width`/`height`. Refusing rather than rewriting keeps the stored file exactly what the admin uploaded.
- The portals check type, size and dimensions in the browser before uploading, for immediate feedback; the server check is the one that counts.

Logos are shown through `<img>`, where browsers never run SVG scripts; R-4's response headers cover the file opened directly.

**Icon is PNG only.** iOS home-screen icons (`apple-touch-icon`) must be raster, and Safari's support for SVG tab icons is uneven, so an SVG icon could not meet FR-015 everywhere. FR-004 is amended in this PR to PNG only; the admin page suggests 512 × 512.

**Alternatives considered**: *sanitising SVG with DOMPurify* needs a DOM (jsdom) in the Lambda and silently changes the admin's file; *rasterising SVG with sharp* adds a native dependency to the Lambda bundle; *dropping SVG logos* loses the format most organisations keep their logo in.

## R-9: Avoiding a flash of the default brand (SC-004)

**Decision**: a `BrandProvider` in `@discava/common-web-utils/brand`, mounted next to `RuntimeConfigProvider` in each portal:
1. Starts from, in order: the brand embedded by the page renderer, else the last brand it saw (kept in `localStorage`), else nothing.
2. If it has a brand, it renders at once and refreshes from `brand.json` in the background; if not, it holds the first render until `brand.json` arrives or 1 s passes, then uses the defaults.
3. Applies the brand to the document: CSS variables, `<link rel="icon">`, `apple-touch-icon`, `theme-color`, and the title suffix.

So a first visit waits for one small cached fetch (made in parallel with `runtime-config.json`), and every later visit renders immediately. A failed or missing `brand.json` (no brand saved yet answers 404) falls back to the defaults (SC-005).

The **admin portal** also feeds the provider from `branding.get` once signed in, and from the result of each save, so the admin who saved sees the change at once rather than after the cache expires (FR-020).

## R-10: Where shared branding code lives

**Decision**: a new package, `packages/common/branding` (`@discava/common-branding`), created with the `ts#project` generator and imported per module:
- `brand` — the brand document's zod schema, `DEFAULT_BRAND` (name "Discava", the current logo data URI moved from `app-config.ts`, no colour, name shown), and `resolveBrand` (stored record or document → full brand with defaults filled in);
- `colour` — hex parsing, contrast, `brandPalette` (R-7);
- `image-rules` — per-kind types, sizes and shape checks, shared by the admin portal's pre-upload check and admin-api.

**Rationale**: the code is used by the portals (browser), admin-api, the brand-publishing handler, the page renderer and core-table's invariant check. `common-server-utils` is server-only (a Biome rule keeps the portals out), and `common-web-utils` is the portals' package; `common-tiptap` is the precedent for a small package both sides import. The package has no runtime dependencies beyond `zod`.

`common-web-utils/app-config.ts` is deleted; its two consumers (`PortalShell`, `SiteLayout`) read `useBrand()`.

## R-11: Where the brand appears in the portals

**Decision**: replace every place the brand is hard-coded:
- `PortalShell` (instructor and admin portals) and `SiteLayout` (student portal): logo, name text (hidden when `showNameBesideLogo` is off), the logo's alt text. The logo is shown at the header's height (40 px) with `object-contain` and a maximum width of 4 × height; on narrow screens, where the name text is already hidden, it shrinks to fit.
- `index.html` `<title>` in all three portals: the provider sets `document.title` to the brand name; routes that set their own title keep the `… | <name>` suffix through a shared helper.
- The student portal home page's copy ("Discava brings …") and footer ("© … Discava") use the brand name; the instructor portal's "To learn on Discava" text too.
- The student portal footer's "Powered by Discava" link stays: it credits the software, not the platform.

## R-12: Hosted sign-in pages and the docs site

Out of scope by clarification. Recorded here because the Cognito managed login (#52) and the local OIDC page keep the default look, so a user signing in briefly sees a different style. No work in this feature.

## R-13: End-to-end tests and a global setting

**Risk**: the brand is one record for the whole local stack, and e2e scenarios run in parallel against it. A branding scenario that changes it changes what every other running scenario sees.

**Decision**: no existing scenario asserts the name "Discava" or the default colours (checked: only comments mention it), so a custom brand cannot break them. The branding scenario runs its tests serially, uses the API to restore the brand it found (by revision) in `afterAll`, and asserts only on its own uniquely named brand (for example "Acme Academy <run id>"). Screenshots other scenarios take while it runs may show its brand; that is cosmetic.
