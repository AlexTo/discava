# Contract: page renderer (crawler content)

Changes to `packages/apis/core-api/src/page-renderer/`. The renderer's routes, caching and headers are those of the public course pages spec ([its contract](../../../20261118-223240-public-course-pages/contracts/page-renderer.md)); only the course outline's markup changes.

## Landing page `/learn/<courseId>`

In the curriculum's nested list (`render-course.ts`), a lesson with `freePreview: true` in `course.publicView`'s output is rendered as:

```html
<li class="text-sm"><a href="/learn/<courseId>/preview/<lessonId>">Lesson title</a> <span>Free preview</span></li>
```

Other lessons stay `<li class="text-sm">Lesson title</li>`. The title and both identifiers are escaped as every value is. The page data script (`discava-page-data`) carries `freePreview` because it carries `course.publicView`'s output.

The response is cached at the edge for 5 minutes like the rest of the page, so a label can outlive an unmarking by that long. The link then leads to the "no longer available" page; the cached page holds no lesson content.

## Preview address `/learn/<courseId>/preview/<lessonId>`

No change. It matches the existing rule for `/learn/<courseId>/<anything>`: the plain `index.html` with `noindex`, always 200, no page data. The renderer does not call `freePreview.lesson` and renders no lesson content.

## `robots.txt` and `sitemap.xml`

No change. `Disallow: /learn/*/` already covers the preview address, and the site map lists `/learn/<courseId>` only.

## Tests

- `render.test.ts`: a course with one marked and one unmarked lesson renders the link and "Free preview" for the first only; a hostile lesson title and identifiers are escaped inside the link.
- `handler.test.ts`: `/learn/<courseId>/preview/<lessonId>` returns the plain template with `noindex`, contains neither a lesson title nor a page data script, and makes no table read.
- `robots.test.ts` and `helpers/sitemap.test.ts`: a case each pinning that the preview address is disallowed and not listed.
