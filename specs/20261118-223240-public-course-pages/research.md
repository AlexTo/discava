# Research: Public Course Landing Pages and Instructor Profiles

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-18

Each entry records a decision, why, and what was rejected. Code references are to `main` at `d8acf5d`.

## R-1: How crawlers get real HTML

**Decision**: Render on request. A Lambda function (the *page renderer*) sits behind the student portal's CloudFront distribution as the origin for `/learn/*`, `/instructors/*`, `/sitemap.xml` and `/robots.txt`. For a course landing page or a profile it reads the built `index.html`, injects the head tags, a static rendering of the page into `#root`, and the page data as JSON, and returns it. CloudFront caches each response for at most 5 minutes (`s-maxage=300` on a page, `60` on a not-found), which bounds staleness (FR-009, SC-003) with no invalidation. Every other `/learn/*` path (course home, lessons) gets the plain `index.html` with `noindex`.

**Rationale**: The renderer always reads the current `index.html`, so a portal redeploy can never leave pages pointing at pruned, hashed assets. Status codes come out right (200 for a public page, 404 for anything else), and an archived course disappears when its cached copy expires. The work happens only on full page loads, and in-app navigation never reaches it.

**Alternatives considered**:
- *Prerender to S3 on change*, as a `STREAM_FEATURES` consumer writing `learn/<id>` objects. Rejected: every portal deploy changes asset hashes and `BucketDeployment` prunes the old ones, so every prerendered page breaks until a full re-render runs. Deleting a page on archive races with the stream, and a missing object falls into the SPA's 200 fallback (R-2).
- *Lambda@Edge*. Rejected: it must be deployed in us-east-1, reads the table cross-region, has no local equivalent (constitution III) and is harder to observe.
- *Full server-side React rendering* (TanStack Start or a custom `renderToString` of the router). Rejected for now: it would move the student portal to a server runtime and couple the renderer to every route component. The static rendering plus seeded data (R-5) meets FR-008 and FR-012 at a fraction of the cost. This can be revisited if pages grow interactive above the fold.
- *A third-party prerender service*. Rejected: it adds a provider outside AWS (constitution I).

## R-2: Not-found status codes behind a single-page app

**Decision**: Replace the distribution-wide `errorResponses` (404/403 → `/index.html` with 200) in `common/constructs/src/core/static-website.ts` with a CloudFront Function on the default behavior's viewer request. It rewrites any path whose last segment has no file extension to `/index.html`. Genuine misses (a missing asset) then return S3's error, and the renderer's own 404s reach the viewer.

**Rationale**: CloudFront's custom error responses apply to every origin of a distribution, so the existing rule would turn the renderer's 404 into a 200 shell. That breaks FR-010 and lets crawlers index "soft 404s". A viewer-request rewrite is the standard way to serve a single-page app without masking errors. All three portals get it from the shared construct, so their behavior stays the same.

**Alternatives considered**: Keeping `errorResponses` and returning 200 with a `noindex` meta for unknown courses. Rejected: search engines treat these as soft 404s, and FR-010 asks for a real status. Per-behavior error pages are not something CloudFront supports.

## R-3: Wiring the renderer into the stack order

**Decision**: The renderer's function, its Function URL (auth `AWS_IAM`) and an origin access control live in the **Websites** stack, attached to the student portal distribution as a `FunctionUrlOrigin.withOriginAccessControl` origin (available in `aws-cdk-lib` 2.275). It needs nothing from later stacks at deploy time:

- It resolves the table name through `resolveTableName()`, which reads AppConfig. The AppConfig application lives in the Data stack, but its name is fixed at synth time (`Names.uniqueResourceName` in `core/runtime-config.ts`). The renderer gets that *name* as `RUNTIME_CONFIG_APP_ID`, and AppConfig's `StartConfigurationSession` accepts a name or an ID. This avoids a CloudFormation reference to the Data stack.
- Read permissions (table read and AppConfig session) are granted to the renderer's role from the **Data** stack, which already depends on Websites, so the reference runs in the existing direction.
- The public media domain (for image URLs) is read from the same runtime config namespace the APIs use.

**Rationale**: Websites deploys first, because Data needs portal domains for Cognito callbacks. A CloudFront origin pointing at anything in a later stack would create a cycle.

**Alternatives considered**:
- *API Gateway origin* (a core-api extra route). Rejected: the distribution would need the API's domain from a later stack, and custom domains are optional per stage.
- *A late stack plus `cf.updateRequestOrigin` from a CloudFront Function reading a KeyValueStore*. Rejected: it has more moving parts (a KeyValueStore, a custom resource to write it, OAC configured at run time) for the same result.

To verify on a deployed stage (plan risk P2): a role from the Websites stack granted from the Data stack is honoured on the first deploy, and AppConfig resolves by name.

## R-4: One source of truth for "what is public"

**Decision**: The renderer is a second Lambda handler in `@discava/core-api`, added with the `ts#lambda-function` generator (`--project=@discava/core-api --name=page-renderer --event=LambdaFunctionUrlSchema --infra=none`; infra is added by hand in `common/constructs`, as the stack placement in R-3 needs). It calls the same procedures the portal calls (`course.publicView`, `instructorProfile.publicView`, `review.summary`, `review.list`) through `appRouter.createCaller` with an anonymous context. The site map's data gathering is a plain helper in `core-api/src/helpers/sitemap.ts`, not a procedure, so it adds no API method.

**Rationale**: FR-005 and FR-007 hinge on exposure rules (draft and archived courses, hidden modules, non-public profiles). Calling the procedures means the crawler can never see more than the API returns, and their tests cover both.

**Alternatives considered**: A new project, `packages/websites/page-renderer`. Rejected: it would have to duplicate or import core-api's procedures anyway.

## R-5: Handing a rendered page to the single-page app without a flash

**Decision**: The renderer writes three things.

1. A static rendering of the page inside `#root`, using the portal's own Tailwind classes for the header (title, image, key facts) so that it looks like the interactive page.
2. `<script type="application/json" id="discava-page-data">`, holding the procedure outputs it used.
3. The usual module script.

On boot, the student portal reads that element (once, then removes it) and seeds React Query with `setQueryData` for the same query keys. The first React render is therefore the full page, not a spinner, and `createRoot` replaces the static markup in the same frame.

**Rationale**: This meets FR-012 without server-side React. The page data holds only what the public procedures already return.

**Alternatives considered**: `hydrateRoot` against the static markup. Rejected: it requires the markup to match React's output exactly, and that is only reliable with true SSR (R-1).

## R-6: Preview video

**Decision**: `course.previewContentItemId` names one of the course's video content items. A new public procedure, `course.previewVideoUrl({ courseId })`, is served by the existing `MediaUrl` dedicated function, the only holder of the signing key. It loads the course and its curriculum and checks FR-003: published, the item is the current preview, it is a playable video (`playableManifest`) and it is effectively visible (`filterEffectivelyVisible`). It then returns the manifest URL, captions and signed cookies scoped to that transcode's directory, exactly as `contentItem.videoUrl` does. It is added to `PUBLIC_OPERATIONS`, so it gets the API's `publicThrottle`.

**Rationale**: This reuses the transcoding, captions and cookie scoping from #277. Cookies scoped to one transcode directory cannot open another item's files (FR-015).

**Alternatives considered**:
- *A separate promo upload per course*. Deferred (spec Assumptions): it needs a second upload and transcode path.
- *Flagging several items as "free preview"*. Deferred.
- *Storing the item's full key* (module, lesson, item). Rejected: moving an item between lessons would leave the reference stale. Storing the ID and resolving it from the curriculum (already read for the outline) never goes stale.

## R-7: Instructor profiles and handles

**Decision**: There are two new entities.

- `instructorProfile` holds one record per instructor, keyed by `instructorId`, with display name, headline, bio, photo key and handle.
- `profileHandleClaim` holds one record per handle, keyed by `handle`, recording which instructor owns it.

This is the same claim pattern as `categoryClaim`, because DynamoDB has no unique index. A profile is created, with a generated handle and the account name, by `ensureInstructorProfile` in `core-table/src/helpers/instructor-profile.ts`. `createCourse` calls it in its transaction, so anyone who is an instructor of a course has a profile (new invariant `instructor-has-profile`).

The handle is generated from the account name: lower-cased, ASCII-folded, non-alphanumerics collapsed to single hyphens, trimmed to 30 characters. If it is taken, the helper tries `-2` through `-9`, then a random 4-character suffix. Each attempt is a conditional create of the claim. A handle change is one transaction: create the new claim (it must not exist), delete the old claim (the condition is that it is still the caller's), and update the profile (the condition is that its handle is the old one).

**Rationale**: Account IDs (Cognito subs) must not appear in public URLs (FR-007). Creating the profile with the course means every instructor card has somewhere to link from the first publish, and no lazy-creation race happens on read.

**Alternatives considered**:
- *Creating profiles lazily on first public read*. Rejected: a public read must not write.
- *Using the account ID in the URL*. Rejected because of FR-007.
- *A GSI on handle*. Rejected: it does not enforce uniqueness.

## R-8: Canonical address and the Host header

**Decision**: A CloudFront Function on the renderer's behaviors copies the viewer's `Host` header into `x-discava-host`, and an origin request policy forwards that header. Function URLs need their own `Host`, so CloudFront replaces it. The renderer builds canonical and Open Graph URLs from that header only if it matches the stage's allowed hosts: the configured student portal domains, or a `*.cloudfront.net` host when none are configured. Otherwise it falls back to the first configured domain.

**Rationale**: Self-referencing canonicals on whatever domain served the page is correct. Validating the host stops someone pointing a domain at the distribution from poisoning canonicals or cached pages.

## R-9: Indexing per stage

**Decision**: A new stage setting, `studentPortal.allowSearchEngineIndexing`, defaults to `false` and is `true` for `discava-production` only. When it is off:

- the renderer adds `<meta name="robots" content="noindex">` and `X-Robots-Tag: noindex` to every response;
- `robots.txt` is `Disallow: /`;
- the student portal's response headers policy adds `X-Robots-Tag: noindex` to every S3-served response.

When it is on, only not-found responses and non-landing `/learn/*` shells carry `noindex`.

**Naming**: the setting is called `allowSearchEngineIndexing`, not `enableIndexing`, because "indexing" already means OpenSearch indexing in Discava (the `courses` search index, the indexing Lambda and the re-index job). The words "search engine" and "allow" match what it controls: whether external crawlers may index the student portal, as `robots.txt` puts it.

**Rationale**: This implements FR-011a and SC-007. Following constitution VI's spirit, the safe value (not indexed) is the default and only production opts in.

## R-10: Site map

**Decision**: `GET /sitemap.xml` is built on request by `helpers/sitemap.ts`. It includes:

- every published course (`course.byStatus('published')`, all pages);
- every instructor of those courses (`courseInstructor` query per course, run in parallel, then a batch get of profiles for handles);
- every active category (the existing category list).

It is cached for 5 minutes at CloudFront. Each `<url>` has a `<lastmod>` taken from the course's or profile's `updatedAt`.

**Rationale**: At pre-launch scale (hundreds of courses) this is a few hundred keyed reads every 5 minutes at most. There is no scan: every read is a key or a declared index (constitution V).

**Limit**: A single site map holds 50,000 URLs. Beyond that, a site map index is a follow-up, which `tasks.md` notes rather than builds.

## R-11: Structured data and social cards

**Decision**:
- Course pages carry schema.org `Course` JSON-LD: `name`, `description`, `provider` (an `Organization` named by the stage's site name, default "Discava"), `instructor[]` (`Person` with name and profile URL), `inLanguage`, `educationalLevel` and `aggregateRating` (only when the count is at least 1).
- Profiles carry `ProfilePage` with a `Person` as `mainEntity`.
- Open Graph and Twitter tags: `og:type` is `website` for a course and `profile` for an instructor, plus `og:title`, `og:description`, `og:image` (course image or photo, else `/og-default.png` shipped in the portal's `public/`), `og:url` (canonical) and `twitter:card` (`summary_large_image`).
- The meta description is the first 155 characters of the description (or the headline for a profile), cut at a word boundary.
- Everything is escaped as HTML text. JSON-LD is serialised with `<`, `>` and `&` written as `<`, `>` and `&` (FR-013).

## R-12: Instructor photos

**Decision**: These follow course images exactly (`instructor-api/procedures/course-image.ts`, `common-server-utils/public-media.ts`): a presigned JPEG upload to the public media bucket under `instructors/<instructorId>/<uuid>.jpg`, then `attach` and `detach` of the previous photo. The portal reuses the course image crop dialog at a 1:1 aspect, output at 512×512.

**Rationale**: The images are already public, and lifecycle tagging and S3Mock locally come for free.

## R-13: Local development

**Decision**: core-api's `dev` target starts a second local server, `src/local-page-renderer.ts`, on port 2026, exported as `LOCAL_PAGE_RENDERER_URL` from `common-server-utils/local-dev` beside `LOCAL_CORE_API_URL` (2022; 2023 to 2025 are taken). It serves the same routes, taking `index.html` from the student portal's Vite dev server (`LOCAL_PORTAL_URLS.student`). Browsers keep using Vite directly, and crawler responses are fetched from the renderer port (quickstart, e2e). `allowSearchEngineIndexing` is off locally, as on every non-production stage.

**Rationale**: This meets FR-016 and constitution III with no CloudFront locally. The end-to-end test fetches the renderer port directly.
