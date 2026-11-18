# Contract: infrastructure changes

## Stage config (`packages/common/infra-config`)

`studentPortal` gains:

| Field | Type | Default | `discava-development` | `discava-production` |
|-------|------|---------|-----------------------|----------------------|
| `allowSearchEngineIndexing` | boolean | `false` | `false` | `true` |
| `siteName` | string | `"Discava"` | default | default |
| `pageRendererReservedConcurrency` | number | `20` | `5` | default |

These fields are added to `stages.types.ts` and env overrides (`<STAGE>_INFRA_STUDENT_PORTAL_ALLOW_SEARCH_ENGINE_INDEXING`, and the others) following `env-overrides.ts`, with tests.

## `common/constructs/src/core/static-website.ts` (all three portals)

- Remove the 404/403 → `/index.html` `errorResponses`.
- Add a CloudFront Function (`cloudfront.FunctionRuntime.JS_2_0`, viewer request) to the default behavior. When the last path segment contains no `.`, it rewrites the URI to `/index.html`. The function source lives in `core/spa-rewrite.js`, with a unit test of the rewrite table: `/`, `/learn/x`, `/assets/a.js`, `/runtime-config.json` and `/foo.bar/baz`.
- A new optional prop, `extraResponseHeaders`, carries custom headers into the existing `ResponseHeadersPolicy`. It is used for `X-Robots-Tag: noindex` when search engine indexing is off.
- Snapshot tests are updated deliberately, and the PR names the behavior change (constitution IV).

## `common/constructs/src/app/static-websites/student-portal.ts`

New props are `pageRenderer?: { allowSearchEngineIndexing, siteName, reservedConcurrency, runtimeConfigAppName, allowedHosts }`. When set, the construct:

- creates the renderer `Function` (a generator-owned wrapper in `lambda-functions/`, using core-api's `page-renderer` bundle, Node 22, 512 MB, 10 s timeout, X-Ray as the APIs do), with reserved concurrency from config;
- adds a Function URL with `AuthType.AWS_IAM`, and a `FunctionUrlOrigin.withOriginAccessControl` origin;
- adds behaviors for `/learn/*`, `/instructors/*`, `/sitemap.xml` and `/robots.txt`:
  - allowed methods `GET`/`HEAD`;
  - a cache policy that keys on path only (no query, cookies or headers) and honours origin `Cache-Control` up to 300 s;
  - an origin request policy forwarding `x-discava-host` only;
  - a viewer-request CloudFront Function that sets `x-discava-host` from `Host` (and skips the SPA rewrite);
  - the same response headers policy and the same WAF as the distribution;
- grants the function `s3:GetObject` on the website bucket's `index.html` only (KMS decrypt where the bucket is encrypted);
- exposes `grantPageRendererRead(...)`-style helpers: `pageRendererGrantable` (its role), for the Data stack.

Checkov: the Function URL with `AWS_IAM` auth satisfies the public-URL rules. Suppress only rules that do not apply, each with a reason, following the existing `suppressRules` usage.

## `packages/infra`

- **`WebsitesStack`** passes `pageRenderer` props from stage config. `runtimeConfigAppName` is computed the same way `RuntimeConfig` names its application (the shared helper is exported from `core/runtime-config.ts` so both use one function).
- **`DataStack`** calls `coreTable.grantReadData(websites.studentPortal.pageRendererGrantable)` and grants `appconfig:StartConfigurationSession` and `appconfig:GetLatestConfiguration` on the runtime config application (the existing `RuntimeConfig` grant helper).
- **`CoreApiStack`**: `CORE_API_DEDICATED_FUNCTIONS.MediaUrl` gains `course.previewVideoUrl`. The synth test that every operation has an integration covers it.
- **`InstructorApiStack`**: `INSTRUCTOR_API_DEDICATED_FUNCTIONS.Media` gains `coursePreview.createUploadUrl`, `create`, `replace` and `remove`; `MediaUrl` gains `coursePreview.createVideoUrl`. Their existing grants already cover `courses/*` in the lesson media bucket and MediaConvert; a synth test confirms no new statement is needed.
- **`MediaPipeline` and `StreamRouter`**: no new resources. The existing MediaConvert completion rule, Transcribe rule, reconciler schedule and cleanup scheduler carry preview jobs, told apart by job metadata.

## Not changed

API Gateway public throttles already cover the new public procedures. No new stack is added, and the resource count added to Websites is about 12 (function, role, policy, URL, OAC, two functions, two policies, log group, and permissions), well under the limit.
