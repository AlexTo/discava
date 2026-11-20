# Contract: the verification page as crawlers get it

The page renderer (`packages/apis/core-api/src/page-renderer/`) answers `/certificates/*` on the student portal's distribution, and on port 2026 under `pnpm dev`.

| Request | Response |
|---------|----------|
| `GET /certificates/<ID>`, certificate exists | 200, the portal's template with the head below, an empty root, `Cache-Control: public, max-age=0, s-maxage=300`, `X-Robots-Tag: noindex` |
| `GET /certificates/<ID>`, malformed or unknown | 404, the renderer's shared not-found page (`notFoundHead`), cached 60 s, `X-Robots-Tag: noindex`. The same bytes for both |
| `GET /certificates/<ID>/linkedin` or any deeper path | 200, the plain template with the site title and `noindex`, as the signed-in learning routes get |
| `GET /certificates` | 404 |
| `HEAD` | The same headers, no body |
| The lookup fails (table, config, template) | 503, not cached, as today |

## Head (`render-certificate.ts`, through `buildHead`)

Read with `certificate.verify` through the renderer's anonymous caller, so it can show only what the page shows.

| Tag | Content |
|-----|---------|
| `<title>`, `og:title`, `twitter:title` | `<learnerName> completed <courseTitle> \| <site name>` |
| `description`, `og:description`, `twitter:description` | `Certificate of completion, <D Month YYYY>. Issued by <site name>. Certificate ID <ID>.` The date is formatted in English, in UTC |
| `canonical`, `og:url` | `https://<host>/certificates/<ID as displayed>` |
| `og:type` | `website` |
| `og:image`, `twitter:image` | the default card image (`/og-default.png`) |
| `robots` | `noindex`, on every stage |
| structured data | none |

- `buildHead` gains two options: `noindex` (forces the robots tag whatever the stage's `allowIndexing`) and an omitted `structuredData` (no script tag).
- Every value goes through `escapeHtml`. A test uses a learner name and course title with `<`, `"` and `&`.
- The ID in the address is normalised: `/certificates/abcd…` without dashes gets the same head, with the canonical address in display form.
- No email, user ID or course ID appears anywhere in the response.

## Distribution (`common/constructs/src/app/static-websites/student-portal.ts`)

`PAGE_RENDERER_PATHS` gains `'/certificates/*'`.

## Site map

Unchanged: verification pages are never listed. A test asserts no site map entry starts with `/certificates`.
