# Implementation Plan: Admin-Set Platform Branding

**Branch**: `20261122-090054-admin-branding` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261122-090054-admin-branding/spec.md`

## Summary

The deployment's brand becomes a singleton record, `platformBrand`, in the core table, written by a new admin-api `branding` router with a revision check, and edited on a new admin portal page, Settings → Branding. Brand images go to the existing public media bucket under `brand/{kind}/{nonce}.{ext}` with the course-image upload pattern (presigned `PUT`, validate on save, attach/detach tags). A new stream router feature, `brand-publishing`, publishes the current record as `brand/brand.json` on the media CDN with a 60 s browser and 240 s CDN cache. The three portals load it through a shared `BrandProvider` that applies the name, logo, icon and colour, and the page renderer reads the record directly and renders the brand into the head of every public page. Shared rules (defaults, the document schema, contrast and palette maths, image rules) live in a new package, `@discava/common-branding`, used by both the browser and the server. The hard-coded brand (`app-config.ts`, the stage's `siteName`, `SITE_NAME`, runtime-config `site.name`, `<title>Discava</title>`) is removed, not kept as a fallback.

What the existing code showed that the spec could not:

1. **Nothing about the brand is dynamic today.** The logo and name are a constant in `common-web-utils/app-config.ts` (two consumers: `PortalShell`, `SiteLayout`); titles and favicons are static in each `index.html`; the page renderer's site name is a stage setting passed as `SITE_NAME`; runtime config is written at deploy time. So the portals need a run-time source that works signed out and costs nothing per visitor: a CDN-cached JSON document (research R-3).
2. **`paymentConnection` is the precedent for an admin-edited singleton** with a `revision` condition and `changedBy`/`changedAt`; `platformBrand` follows it (R-1, R-2).
3. **Public media URLs are immutable by construction** (a new nonce per upload, no `Cache-Control` set, the distribution's default cache policy). Brand images keep that, so a replaced logo can never be served stale (R-5).
4. **The page renderer already caches pages for 300 s at CloudFront**, which fits the spec's 5-minute propagation exactly; it reads the table per render, so it needs no published document (R-6).
5. **The icon must be PNG.** iOS home-screen icons cannot be SVG. FR-004 is amended to PNG only (spec updated in this PR, R-8).
6. **Links cannot always take the brand colour.** A pale brand colour on white fails contrast. Links use it only when it reaches 4.5:1 against the page; FR-018 is amended (spec updated in this PR, R-7).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), AWS SDK v3 S3 client and presigner (through `@discava/common-server-utils/public-media`), TanStack Router/Query, shadcn (`@discava/common-shadcn`); new: `image-size` (raster dimensions, pure JS) and `fast-xml-parser` (SVG allow-list), both in admin-api only

**Storage**: the core table (new singleton entity `platformBrand`, no new index); the existing public media bucket (`brand/` prefix)

**Testing**: vitest per project; core-table `helpers/invariants/`; admin portal and `common-web-utils` component tests; Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront + S3; `pnpm dev` with Docker locally (S3Mock, DynamoDB local, the local event runner)

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: a saved change on every new page load within 5 minutes (SC-002); no added wait on repeat visits and at most one cached fetch (in parallel with `runtime-config.json`, capped at 1 s) on a first visit (SC-004); one extra key read per page-renderer render, which CloudFront caches for 300 s

**Constraints**: no scan in a user request; no second table or bucket; no Lambda or table read per visitor page load for the brand; uploaded files never run scripts (FR-006); works under `pnpm dev` without AWS (FR-021)

**Scale/Scope**: one brand per deployment; five optional fields and one switch; at most three live brand images, plus replaced ones awaiting the 1-day lifecycle deletion

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | DynamoDB, S3, CloudFront, Lambda through the existing stream router. No new service |
| II. Generators first | Pass | `@discava/common-branding` is created with the `ts#project` generator; the `events-brand-publishing` Lambda wrapper with `ts#lambda-function`, as the other `events-*` wrappers are. Everything else extends generated projects. The first task confirms both generators via the MCP server |
| III. Everything runs locally | Pass | The record is in DynamoDB local, images and `brand.json` in S3Mock, `brand-publishing` runs under the local event runner through `HANDLERS`, and the page renderer reads the local table. One open point: S3Mock's CORS answer for the portals' `fetch`; a task checks it and falls back to a Vite proxy for `/brand` locally if needed (R-4) |
| IV. Layered tests | Pass, planned | Unit tests for `common-branding`, the core-table helper, the admin-api procedures, the handler, the renderer and `BrandProvider`; a new invariant with breaking tests; an e2e scenario and a concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | One entity with a constant key; three access patterns, all on the primary key ([data-model.md](./data-model.md)); no index, no scan. The new record is routed by `STREAM_FEATURES` to `brand-publishing` only, and the existing features' filters are checked not to match it |
| VI. Secure by default | Pass | Writes only through `adminProcedure`; uploads presigned per kind with exact type and length; server-side validation of every image, including an SVG allow-list; `brand/*` served with a sandboxing `Content-Security-Policy` and `nosniff`; the published document omits who saved. admin-api gets `s3:PutObject`/`GetObject`/`PutObjectTagging` on `brand/*` only; the publishing Lambda gets `PutObject` on `brand/brand.json` only |
| VII. Change freely before launch | Pass | `studentPortal.siteName`, `SITE_NAME`, runtime-config `site.name` and `app-config.ts` are removed outright; consumers move to the brand. No fallback for old config |
| VIII. Repo conventions | Pass | `core-table/src/helpers/platform-brand.ts`, `invariants/branding.ts`; the upload helpers move to `common-server-utils/public-media` now that two APIs use them; text-only buttons; the page's e2e scenario takes `screenshot()`s; docs in English, translations noted as pending in the PR |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `platformBrand` (new) | Written by admin-api through `saveBrand`; read by the page renderer and the `brand-publishing` handler | none yet | New check `platform-brand-shape` (`helpers/invariants/branding.ts`) with a breaking test per rule; `snapshot.ts` reads the entity; `entity-writers.json` regenerated |
| Stream features (`STREAM_FEATURES`) | New registration `brand-publishing` for `platformBrand` inserts and modifications | `stream-features.test.ts`; `progress-stream`, `search-stream`, `analytics-stream`, `notification-stream`, `earnings-stream` tests; `events/src/router/handlers.test.ts` | New `brand-stream.test.ts`; `stream-features.test.ts` asserts `platformBrand` records go to `brand-publishing` and to no other feature. No existing feature's filters change |
| `course`, `instructorProfile`, `certificate`, `category` | Read by the page renderer exactly as today | unchanged | None |

The feature writes no counter, enrolment, completion or content record.

## Design Decisions (detail in [research.md](./research.md))

1. **Singleton record with a revision** (R-1, R-2). `platformBrand` with a constant key; the form saves the whole brand with the revision it loaded; a stale save gets `CONFLICT`.
2. **Images in the public media bucket with immutable keys** (R-5). `brand/{kind}/{nonce}.{ext}`, year-long immutable cache, attach/detach tags and the existing lifecycle rule for clean-up. The upload helpers move from instructor-api to `common-server-utils/public-media` and take a content type.
3. **Validate on save, refuse rather than rewrite** (R-8). Per-kind type, size and shape rules shared with the browser's pre-check; raster dimensions from the header; an allow-list for SVG logos. Icons are PNG only.
4. **Publish a document for the portals; read the record in the renderer** (R-3, R-6). `brand-publishing` writes the current record to `brand/brand.json` (`max-age=60, s-maxage=240`), so portals pay one cached fetch; the renderer reads the table per render and is cached 300 s.
5. **One palette helper everywhere** (R-7). `brandPalette(hex)` picks the readable text colour, refuses the narrow failing band, and gives links the brand colour only when it is readable on white. The same code runs in admin-api, the preview, the portals and the renderer.
6. **No flash** (R-9). `BrandProvider` starts from the renderer's embedded brand or the last brand in `localStorage`, otherwise waits up to 1 s for `brand.json`; the renderer inlines the colour so server-rendered pages are right before any script.
7. **One source for the name** (R-6, R-11). The default name is a constant in `@discava/common-branding`; the stage `siteName`, `SITE_NAME` and runtime-config `site.name` go. LinkedIn sharing, which sends the site name as text when no organisation ID is set, sends the brand name.
8. **New shared package** (R-10). `@discava/common-branding` (`brand`, `colour`, `image-rules`), imported per module by the portals, admin-api, events, core-api and core-table.

## Project Structure

### Documentation (this feature)

```text
specs/20261122-090054-admin-branding/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-api-branding.md
│   ├── brand-document.md
│   └── admin-portal-ui.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── common/branding/src/                      # new (ts#project): brand.ts, colour.ts, image-rules.ts (+ tests)
├── common/server-utils/src/public-media.ts   # + presignPublicMediaUpload, head/get/attach/detach (moved from instructor-api), brand key helpers (+ test)
├── databases/core-table/src/
│   ├── entities/platform-brand.ts            # new (+ index.ts, service.ts)
│   └── helpers/
│       ├── platform-brand.ts                 # getBrand, saveBrand, BrandConflictError (+ test)
│       ├── brand-stream.ts                   # BRAND_STREAM_FILTERS (+ test)
│       ├── stream-features.ts                # the `brand-publishing` registration (+ routing tests)
│       └── invariants/branding.ts            # platform-brand-shape (+ breaking tests); snapshot.ts, index.ts
├── databases/core-table/entity-writers.json  # regenerated
├── apis/admin-api/src/
│   ├── procedures/branding.ts                # get, createUploadUrl, save (+ test)
│   ├── helpers/brand-image.ts                # read and check an uploaded image, SVG allow-list (+ test)
│   ├── schema/branding.ts
│   └── router.ts
├── apis/instructor-api/src/helpers/public-media-client.ts   # removed; procedures import common-server-utils/public-media
├── apis/core-api/src/page-renderer/          # handler.ts, page.ts, html.ts, render-*.ts: brand from getBrand (+ tests)
├── events/src/branding/brand-publishing.ts   # the feature's handler (+ test)
├── events/src/router/handlers.ts             # `brand-publishing` added to HANDLERS
├── common/constructs/src/app/
│   ├── lambda-functions/                     # generator-created events-brand-publishing
│   ├── s3/public-media-bucket.ts             # `brand/*` behavior: CORS + CSP response headers policy (+ test)
│   ├── apis/admin-api.ts                     # S3 grants on brand/* (+ test)
│   └── static-websites/student-portal.ts     # SITE_NAME removed
├── infra/src/stacks/{stream-router-stack,websites-stack}.ts   # wire the Lambda and its grant; drop site name
├── common/infra-config/src/stages.types.ts   # studentPortal.siteName removed (+ config, tests)
├── common/web-utils/src/
│   ├── brand.ts                              # BrandProvider, useBrand, applyBrandToDocument, pageTitle (+ test)
│   └── app-config.ts                         # removed
├── common/shadcn/src/
│   ├── components/portal-shell.tsx           # logo, name, showNameBesideLogo from useBrand (+ test)
│   └── styles/globals.css                    # --brand-link variable; links use it
├── websites/admin-portal/src/routes/settings/branding.tsx   # + -components/, -branding.test.tsx; sidebar entry
├── websites/{student,instructor,admin}-portal/src/main.tsx  # mount BrandProvider
├── websites/student-portal/src/                             # SiteLayout, catalogue copy and footer, LinkedIn/owner-share name
├── websites/instructor-portal/src/routes/_authenticated/route.tsx   # restricted-portal text
├── e2e/src/{scenarios/branding.e2e.ts, concurrency/brand-save.e2e.ts, helpers/branding.ts}   # + image fixtures
docs/src/content/docs/en/                     # admin guide page "Branding"; design/branding.mdx; row in design/stream-event-router.mdx
```

**Structure Decision**: extend existing packages; the new projects are the `common-branding` library and the generator-created `events-brand-publishing` Lambda wrapper. The publishing handler lives in `packages/events` beside the other stream features; `BrandProvider` in `common-web-utils` because all three portals use it; header UI stays in `common-shadcn` (`PortalShell`) and the student portal's `SiteLayout`.

## Risks

- **R1: S3Mock and CORS.** If S3Mock does not answer the portals' cross-origin `fetch` of `brand.json`, local dev breaks while deployed works. A task checks it first; the fallback is a Vite dev-server proxy for `/brand` (R-4).
- **R2: The 5-minute budget is a sum of caches.** Browser 60 s + CDN 240 s for `brand.json`; renderer pages 300 s at CDN with `max-age=0`. Any later change to these numbers must keep the sum ≤ 300 s; the construct test pins the cache headers.
- **R3: A failing publish leaves `brand.json` behind the table.** The feature's queue redelivers up to 5 times, then the failure queue alarms; republishing is idempotent and always uses the current record, so a redrive is safe. The admin portal shows the table's brand, so an admin could believe a change is live when it is not; the alarm is the signal.
- **R4: SVG allow-list too strict.** Real-world logo SVGs from design tools carry metadata elements (`sodipodi:*`, `inkscape:*`, `metadata`). The allow-list ignores unknown namespaced metadata elements and attributes that cannot reference anything, and the refusal message names the offending element so an admin can re-export. Fixtures from common tools go in the tests.
- **R5: A global record in a shared e2e stack.** The branding scenario changes what parallel scenarios see. No scenario asserts the default brand; the branding scenario runs serially, uses a unique name and restores the brand it found (R-13).
- **R6: Flash on a first visit over a slow network.** The provider waits at most 1 s, then shows the default brand and switches when the document arrives. Repeat visits use the cached brand. Measured by a `(human)` check on a throttled connection.

## Complexity Tracking

*No constitution violations.*
