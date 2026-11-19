# Contract: page renderer (HTTP)

**Handler**: `packages/apis/core-api/src/page-renderer/handler.ts` (Lambda Function URL event, generated with `ts#lambda-function`).

**Local**: `src/local-page-renderer.ts` on `LOCAL_PAGE_RENDERER_URL` (port 2026).

**Deployed**: Function URL behind the student portal distribution. CloudFront path patterns `/learn/*`, `/instructors/*`, `/sitemap.xml` and `/robots.txt` send requests to it. Only `GET` and `HEAD` are allowed; anything else returns `405`.

## Inputs

- Path and query, as received. The query is ignored for rendering, and the cache key excludes it.
- `x-discava-host`: the viewer's host, set by a CloudFront Function. It is used only if it is in the allowed host list (research R-8).
- No cookies or `Authorization` header: the cache policy and origin request policy forward neither. A response never depends on who is asking.

## Routes

| Path | 200 when | Otherwise |
|------|----------|-----------|
| `/learn/<courseId>` (optional trailing slash) | `course.publicView` succeeds | `404` page |
| `/learn/<courseId>/<anything>` | Always: the plain `index.html` with `noindex` (these are signed-in learning routes) | none |
| `/instructors/<handle>` (optional trailing slash, any case) | `instructorProfile.publicView` succeeds | `404` page |
| `/sitemap.xml` | Always | none |
| `/robots.txt` | Always | none |

A handle given in a different case or with a trailing slash still renders. The canonical URL is always `https://<host>/learn/<courseId>` or `https://<host>/instructors/<handle-lowercase>`, with no trailing slash.

## Response: landing page or profile (200)

- `Content-Type: text/html; charset=utf-8`
- `Cache-Control: public, max-age=0, s-maxage=300`. Browsers always revalidate, and CloudFront keeps the response for 5 minutes.
- `X-Robots-Tag: noindex` only when search engine indexing is off for the stage.
- The body is the current `index.html` with:
  - `<title>`: `<course title> | <site name>`, or `<display name> | <site name>` for a profile.
  - `<meta name="description">`, `<link rel="canonical">`, and the Open Graph and Twitter tags (research R-11).
  - `<meta name="robots" content="noindex">` when search engine indexing is off.
  - `<script type="application/ld+json">` with the structured data.
  - Inside `#root`, static semantic HTML.
    - **Course**: `h1` title; image; a key facts list; "What you'll learn" `ul`; "Requirements" `ul`; description paragraphs; curriculum as nested `ol` of module and lesson titles; rating summary; the first page of reviews (display name, rating, text); and an instructor card for each instructor, linking to `/instructors/<handle>`.
    - **Profile**: `h1` display name; headline; photo; bio paragraphs; course links.
  - `<script type="application/json" id="discava-page-data">`: `{ "course.publicView": {...}, "review.summary": {...}, "review.list": {...} }` or `{ "instructorProfile.publicView": {...} }`, keyed so the portal can seed the matching queries.
- Every text value is HTML-escaped. JSON in script tags has `<`, `>` and `&` written as `<`, `>` and `&`. Unit tests feed `</script><script>alert(1)</script>` through every field.

## Response: not found (404)

- `Cache-Control: public, max-age=0, s-maxage=60`
- `X-Robots-Tag: noindex` always, plus `<meta name="robots" content="noindex">`.
- The body is the current `index.html` with `<title>Not found | <site name></title>`. It has no page data, so the single-page app boots and shows its usual "Course not found" or "Instructor not found" screen.
- The body is byte-identical for a draft course, an archived course and an unknown ID (FR-005, US1 AS3); a test compares them.

## `/robots.txt`

- **Search engine indexing on**:

  ```text
  User-agent: *
  Disallow: /learn/*/
  Disallow: /my-learning
  Disallow: /signin
  Disallow: /search
  Allow: /
  Sitemap: https://<host>/sitemap.xml
  ```

  `Disallow: /learn/*/` keeps the course home and lessons out of the index, while `/learn/<id>` stays allowed.

- **Search engine indexing off**: `User-agent: *` and `Disallow: /`.
- `Cache-Control: public, max-age=300, s-maxage=300`.

## `/sitemap.xml`

- A standard `urlset` built from `sitemapEntries`: `/learn/<courseId>` for each published course, `/instructors/<handle>` for each public profile, and `/category/<slug>` for each active category. Each entry has a `lastmod`.
- `Cache-Control: public, max-age=300, s-maxage=300`.
- With search engine indexing off it is still served, so it can be tested, but `robots.txt` does not list it.

## Failure

If a dependency fails (the table or AppConfig), the response is a plain-text `503` (`Content-Type: text/plain`, body `Service temporarily unavailable`) with `Cache-Control: no-store`, `X-Robots-Tag: noindex` and `Retry-After: 5`. It carries no HTML, so a full page load during an outage shows that text. The error is logged with the request path. A failure is never cached and never turned into a 404.

## The `index.html` template

- **Deployed**: read from the website bucket (`GetObject index.html`, granted read on that key only). The renderer keeps the last body and its `ETag` in memory, and on every request sends `GetObject` with `If-None-Match: <etag>`. A `304` reuses the cached body; a `200` replaces it. There is no fixed-time cache: a portal deploy prunes old hashed assets and then invalidates the distribution, and a fixed cache would let a warm renderer keep serving the old `index.html` after that invalidation, with CloudFront then caching pages that reference deleted bundles for up to 300 s.
  - If the conditional read fails (S3 error or timeout), the request gets the usual dependency-failure `503` with `no-store`. It does not fall back to the cached body, because that body may be the stale one.
  - A unit test pins this: a template whose `ETag` changes between two requests on the same warm handler renders the new asset references on the second request, a `304` reuses the body without re-parsing, and an S3 failure gives a `503`.
- **Locally**: fetched from `LOCAL_PORTAL_URLS.student`.

The renderer inserts its head tags before `</head>` and replaces the empty `<div id="root"></div>`. If that marker is missing, it fails the request with 503 rather than serving a broken page, and a unit test pins the marker against the portal's `index.html`.
