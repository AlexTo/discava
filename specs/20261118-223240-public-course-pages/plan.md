# Implementation Plan: Public Course Landing Pages and Instructor Profiles

**Branch**: `20261118-223240-public-course-pages` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261118-223240-public-course-pages/spec.md`

## Summary

The course page at `/learn/<courseId>` becomes the landing page. It gains outcomes, requirements, a preview video and instructor cards, and a new `/instructors/<handle>` profile page sits beside it.

- **Data**: `course` gets three attributes, and there are two new entities, `instructorProfile` and `profileHandleClaim`. All writes go through two `core-table` helpers, `courseLandingWrites` and `instructorProfileWrites`, with five new invariants.
- **core-api**: `course.publicView` grows; two public procedures are added: `course.previewVideoUrl` in the existing `MediaUrl` signing function, and `instructorProfile.publicView`.
- **instructor-api**: gains `course.updateLanding` and `profile.*`. `course.create` now creates the caller's profile, and permanently deleting a content item clears the preview if that item was it.
- **Crawler HTML**: a page renderer, a second Lambda handler in core-api, sits behind the student portal's CloudFront distribution for `/learn/*`, `/instructors/*`, `/sitemap.xml` and `/robots.txt`. It calls the same public procedures in-process, injects head tags, a static rendering and seed data into the built `index.html`, and is cached at the edge for 5 minutes.
- **Search engine indexing**: a per-stage `allowSearchEngineIndexing`, on only in production.

What the code showed that the spec could not:

1. **A public course page already exists.** `course.publicView` is public, returns `NOT_FOUND` for drafts and archived courses, and filters hidden modules. `CoursePage` renders it signed out. This feature extends both and adds no second page (research R-4).
2. **The SPA fallback would swallow 404s.** `StaticWebsite` maps every 403 and 404 to `/index.html` with 200, distribution-wide. That would turn the renderer's 404s into soft 404s. It is replaced by a CloudFront Function rewrite for all three portals (research R-2).
3. **Websites deploys before everything.** The renderer must live in the Websites stack and late-bind the table through AppConfig, by an application name that is fixed at synth time. The Data stack then grants it read access (research R-3).
4. **Video playback already uses directory-scoped signed cookies** (`contentItem.videoUrl`). An anonymous preview can reuse that mechanism scoped to one transcode, so no other file opens up (research R-6).
5. **`instructorId` is a Cognito sub.** It cannot go in public URLs or outputs, hence handles and their claim records (research R-7).
6. **`course.updatedAt` is mirrored in `courseInstructor.courseUpdatedAt`** (invariant `instructor-course-updated-at`). Landing writes and the preview clear must sync it, as `helpers/course-catalogue.ts` does.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC and zod, ElectroDB (`@discava/core-table`), TanStack Router and Query, shadcn (`@discava/common-shadcn`, including `HlsVideo` and the crop dialog), `aws-cdk-lib` 2.275 (`FunctionUrlOrigin.withOriginAccessControl`, CloudFront Functions JS 2.0). No new runtime library: HTML is assembled with a small escaping helper, not a template engine.

**Storage**: The one core table. Three new attributes on `course`; new entities `instructorProfile` and `profileHandleClaim`. No new index. Photos go in the existing public media bucket.

**Testing**: vitest per project (with the `@discava/core-table` alias), `helpers/invariants.ts` checks with breaking tests, construct snapshot and unit tests, portal component tests, and a Playwright e2e scenario that also fetches the local renderer.

**Target Platform**: AWS Lambda (Function URL with OAC), CloudFront, API Gateway, DynamoDB. Locally, `pnpm dev` with Docker.

**Project Type**: Web application: a serverless backend plus React portals.

**Performance Goals**: A cache miss renders in under 500 ms at p95: 3 to 4 keyed reads plus one batch, and the `index.html` template is cached for 60 s. Cache hits are served by CloudFront. The landing page's first paint needs no API call (SC-004).

**Constraints**:
- Public outputs carry no IDs of people.
- Crawler content is stale by at most 5 minutes.
- No response depends on cookies or auth (it is cacheable).
- Pages are not indexed outside production.
- No scans in requests.
- Everything works under `pnpm dev`.

**Scale/Scope**: At most 25 instructors per course and 100 courses per profile list. The site map is a single file of up to 50,000 URLs; a site map index is a follow-up.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, Function URL with OAC, CloudFront Functions, DynamoDB and AppConfig; no third-party prerenderer |
| II. Generators first | Pass | The renderer handler is created with `ts#lambda-function` on `@discava/core-api` (`--event=LambdaFunctionUrlSchema --infra=none`). Its infra is hand-written in `common/constructs`, because the generator's infra would place it in its own stack wiring, which R-3 rules out (the plan records this). The new routes in both portals use the existing TanStack file routes |
| III. Everything runs locally | Pass | A local renderer on port 2026 (R-13); preview playback, photos (S3Mock) and profiles run locally. CloudFront Functions have no local stand-in; that is a documented exception, since their only job (SPA rewrite and host copy) is covered by unit tests of the function source, and Vite does the SPA fallback locally |
| IV. Layered tests | Pass, planned | Unit tests for the helpers, procedures, renderer (escaping, statuses, noindex) and constructs; five new invariants and one extended invariant, each with breaking tests; a new e2e scenario; an impact check below; a concurrency test for handle claims |
| V. Single-table via ElectroDB | Pass | Access patterns AP1 to AP6 in [data-model.md](./data-model.md): keys, the existing gsi1 and batch gets. No new index. No scans in requests. `STREAM_FEATURES` considered: search re-indexes on `course` modifications (harmless); progress ignores the new records (tested) |
| VI. Secure by default | Pass | `allowSearchEngineIndexing` defaults off; the Function URL uses `AWS_IAM` with OAC; the renderer behaviors share the portal's WAF and headers policy; the renderer's role reads only `index.html`, the table (read) and AppConfig; anonymous preview cookies cover one directory |
| VII. Change freely before launch | Pass | Attributes, entities and routes are added outright; handle changes do not redirect; development instructors get profiles from the seed script or by hand |
| VIII. Repo conventions | Pass | `helpers/course-landing.ts`, `helpers/instructor-profile.ts` and `core-api/src/helpers/sitemap.ts`; text-only buttons ("Move up"/"Move down"); screenshots in e2e; English docs page with translations pending noted in the PR |

**Impact check (constitution IV).** These are the shared records the feature writes, or reads in a new way.

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `course` | Written: `learningOutcomes`, `requirements` and `previewContentItemId` through `courseLandingWrites`; the preview is cleared by `deletePermanently` | `instructor-course-updated-at`, `published-at-set`, `course-has-instructor`, `draft-course-nothing-archived`, `course-category-exists` | New `course-landing-shape` and `course-preview-is-course-video`. Extend the `instructor-course-updated-at` tests to cover both new writers |
| `courseInstructor` | Written: the `courseUpdatedAt` sync (existing pattern). Read: cards, profile course list and site map | `instructor-course-updated-at`, `course-has-instructor`, `instructor-has-user` | New `instructor-has-profile` |
| `contentItem` | Read: preview eligibility and the condition check. Its permanent delete gains a course write | `video-transcode-state`, `caption-tracks-valid`, `curriculum-has-parents`, `student-records-have-targets` | None changed; the new preview check covers the reference |
| `user` | Read once, for the default display name | `instructor-has-user` | None |
| `courseRating`, `category` | Read only | `course-rating-matches-reviews` (when #279 is merged), `course-category-exists`, `category-claims-consistent` | None |
| `instructorProfile`, `profileHandleClaim` (new) | Written only by `instructorProfileWrites` | none yet | New `instructor-profile-shape` and `profile-handle-claims-consistent` |
| Stream consumers | Search: `course` modify, then re-index (unchanged behavior). Progress: must ignore `instructorProfile` and `profileHandleClaim` | `search-stream.test.ts`, `progress-stream.test.ts` | Tests: progress filters ignore both new entities; search filters ignore them too |

## Design Decisions (detail in [research.md](./research.md))

1. **Render on request, cache at the edge** (R-1). A miss costs one Lambda run; a hit costs nothing. Freshness is bounded by `s-maxage=300`, and archiving needs no invalidation.
2. **Real 404s** (R-2) via a CloudFront Function SPA rewrite in the shared construct, replacing the distribution-wide error responses.
3. **The renderer lives in Websites and late-binds** (R-3): AppConfig by application name; the table grant comes from the Data stack.
4. **The renderer reuses the public procedures** (R-4) through `createCaller`, so the crawler sees exactly what the API exposes.
5. **Static markup plus seed data** (R-5), so the app's first render is the full page.
6. **Preview equals one existing video item** (R-6), signed by `MediaUrl` with cookies for one directory, and checked for visibility on every request.
7. **Profiles with claimed handles** (R-7), created with an instructor's first course; visibility is derived, not stored.
8. **Host allowlist for canonicals** (R-8); **search engine indexing off by default** (R-9); **on-request site map** (R-10).

## Project Structure

### Documentation (this feature)

```text
specs/20261118-223240-public-course-pages/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-public.md
│   ├── instructor-api-landing.md
│   ├── page-renderer.md
│   ├── infra.md
│   └── portal-ui.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/course.ts                        # + learningOutcomes, requirements, previewContentItemId
│   ├── entities/instructor-profile.ts            # new (+ index.ts, service.ts)
│   ├── entities/profile-handle-claim.ts          # new
│   └── helpers/
│       ├── course-landing.ts                     # courseLandingWrites, clearPreviewIfMatches (+ test)
│       ├── instructor-profile.ts                 # instructorProfileWrites, handleFromName (+ test)
│       └── invariants.ts                         # five new checks, extended tests
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/course.ts                  # publicView extended; previewVideoUrl (+ tests)
│   │   ├── procedures/instructor-profile.ts      # publicView (+ test)
│   │   ├── helpers/sitemap.ts                    # sitemapEntries (+ test)
│   │   ├── page-renderer/                        # generated handler + render-course.ts, render-profile.ts, html.ts, robots.ts (+ tests)
│   │   ├── local-page-renderer.ts                # pnpm dev, port 2026
│   │   └── router.ts                             # + PUBLIC_OPERATIONS (+ router.test.ts)
│   └── instructor-api/src/procedures/
│       ├── course-landing.ts                     # updateLanding (+ test)
│       ├── profile.ts                            # get, update, createPhotoUploadUrl, updatePhoto (+ test)
│       ├── course.ts                             # create → ensureInstructorProfile
│       └── content-item-shared.ts                # deletePermanently → clearPreviewIfMatches
├── common/
│   ├── constructs/src/core/static-website.ts     # SPA rewrite function; extraResponseHeaders
│   ├── constructs/src/core/spa-rewrite.js        # new (+ test)
│   ├── constructs/src/app/static-websites/student-portal.ts   # renderer origin and behaviors
│   ├── constructs/src/app/lambda-functions/      # generator-owned wrapper for page-renderer
│   ├── constructs/src/app/apis/core-api.ts       # MediaUrl += course.previewVideoUrl
│   ├── infra-config/src/                         # studentPortal.allowSearchEngineIndexing, siteName, pageRendererReservedConcurrency
│   └── server-utils/src/local-dev.ts             # LOCAL_PAGE_RENDERER_URL
├── infra/src/stacks/                             # websites-stack.ts (props), data-stack.ts (grants)
├── websites/
│   ├── student-portal/src/                       # course-page sections, preview, instructor cards, routes/instructors/$handle.tsx, lib/page-data.ts, public/og-default.png
│   └── instructor-portal/src/routes/_authenticated/   # landing page card and checklist; profile.tsx
├── common/scripts/src/local-data/                # seed: profiles for seeded instructors
└── e2e/src/
    ├── scenarios/public-landing-page.e2e.ts
    ├── concurrency/profile-handle.e2e.ts
    └── helpers/public-pages.ts
docs/src/content/docs/en/                         # design/public-pages.mdx; instructor guide section
```

**Structure Decision**: Extend the existing packages; no new project. The renderer is a second handler in `@discava/core-api` (R-4), and its CDK wrapper sits with the other generator-owned functions in `common/constructs`.

## Risks

- **P1: The SPA rewrite changes all three portals.** A path with a dot in its last segment that is really a route (none today) would 404. The rewrite table's unit test lists every route pattern, and the deployed check in quickstart step 2 covers it.
- **P2: Late binding across stacks** (R-3). If AppConfig rejects the name or the cross-stack grant lags on first deploy, the renderer returns 503 (never cached) and pages still boot. This is verified on `discava-development` before merge (human task).
- **P3: Cache poisoning through Host.** Only allow-listed hosts reach canonicals. The cache key excludes headers and cookies, and responses never vary by user.
- **P4: Anonymous preview abuse.** The public throttle and WAF apply, and cookies cover one directory with today's lifetime. Cost is bounded by the existing media CloudFront and its WAF.
- **P5: Static markup drifting from the React page.** A component test renders both for the same data and compares the header text. FR-012 is checked by hand on a deployed stage.
- **P6: Site map cost at scale.** Reads are bounded and cached for 5 minutes. A site map index beyond 50,000 URLs is noted as a follow-up.
- **P7: Merge order with #279 and #283.** The renderer reads `review.summary` and `review.list` and category labels where present. Tasks say "use if present", and both are on `main` today.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|------------|--------------------------------------|
| Renderer infra written by hand, not generator infra (principle II) | The function must sit in the Websites stack behind the portal's distribution (R-3) | The generator's `--infra=lambda` places the function as a standalone construct without the distribution wiring, which would create a stack cycle |
| No local CloudFront Function stand-in (principle III) | CloudFront Functions run only at the edge | The functions are pure URI and header rewrites, tested as units; Vite and the local renderer cover the behavior locally |
