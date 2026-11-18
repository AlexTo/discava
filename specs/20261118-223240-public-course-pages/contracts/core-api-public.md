# Contract: core-api public procedures

All three procedures are in `PUBLIC_OPERATIONS` (`packages/apis/core-api/src/router.ts`), so they skip the Cognito authorizer and get the API's `publicThrottle`. `router.test.ts` checks the list against how each procedure treats an anonymous caller. No output contains an email, a Cognito `sub`/`userId`/`instructorId`, or a draft or archived course.

## `course.publicView` (extended)

**Input**: `{ courseId: string }` (unchanged)

**Errors**: `NOT_FOUND` for a course that is unknown, draft or archived (unchanged, and for every caller including enrolled students).

**Output**: The existing fields (course attributes, `modules[].lessons[]` of visible records), plus:

```ts
{
  learningOutcomes: string[];          // [] when unset
  requirements: string[];              // [] when unset
  category?: { slug: string; name: string };   // when the course has an active category
  preview?: {                          // only when FR-003 holds right now
    moduleId: string;
    lessonId: string;
    contentItemId: string;
    title: string;
    durationSeconds?: number;
  };
  instructors: Array<{                 // ordered by courseInstructor.createdAt
    handle: string;
    displayName: string;
    headline?: string;
    photoKey?: string;                 // public media key; client builds the URL
  }>;
}
```

- `previewContentItemId`, `createdAt`/`updatedAt` of instructors, and any `instructorId` MUST NOT appear in the output (the zod output schema strips them; a test checks).
- `lastChildOrder` and other authoring fields already present stay as today.

## `course.previewVideoUrl` (new; dedicated `MediaUrl` function)

**Input**: `{ courseId: string }`

**Behavior**: Reads the course's curriculum (one collection query). It succeeds only if the course is `published`, `previewContentItemId` is set and names a `video` item for which `playableManifest(item)` is defined, and the item, its lesson and its module are all shown (`isShown` on each). Otherwise it returns `NOT_FOUND` with the message "This preview is not available". It is identical for signed-in and anonymous callers.

**Output**: The same shape as `contentItem.videoUrl` minus `resumeAt`:

```ts
{ url: string; withCredentials: boolean; versionId: string;
  captions: Array<{ trackId: string; language: string; label: string; isDefault: boolean; url: string }> }
```

**Side effect**: `Set-Cookie` with CloudFront signed cookies scoped to the preview transcode's directory only (`prefixKey` from the manifest), with the same lifetime as `contentItem.videoUrl`.

**Tests**: anonymous success; each failing condition gives `NOT_FOUND`; the cookie policy resource equals the preview's directory; any other video item of the same course is refused by `contentItem.videoUrl` for anonymous and non-enrolled callers (unchanged).

`CORE_API_DEDICATED_FUNCTIONS.MediaUrl` gains `'course.previewVideoUrl'`.

## `instructorProfile.publicView` (new)

**Input**: `{ handle: string }`. The handle is lower-cased before lookup. Input that fails the handle pattern returns `NOT_FOUND`, not a validation error, so probing reveals nothing.

**Errors**: `NOT_FOUND` when there is no claim, no profile, or the instructor teaches no published course.

**Output**:

```ts
{
  handle: string;
  displayName: string;
  headline?: string;
  bio?: string;
  photoKey?: string;
  courses: Array<{                    // published only, newest publishedAt first
    courseId: string; title: string; imageKey?: string;
    ratingAverage?: number; ratingCount: number;
  }>;
}
```

## Not a procedure: site map data

`core-api/src/helpers/sitemap.ts` exports `sitemapEntries(coreTable): Promise<Array<{ path: string; lastmod: string }>>`. Only the page renderer uses it, so it is not routed and adds no API Gateway method.
