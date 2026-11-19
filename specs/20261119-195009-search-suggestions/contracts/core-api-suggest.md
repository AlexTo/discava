# Contract: `course.publicSuggest` (core-api)

A public tRPC **query** on the core API, built on `publicSearchProcedure`. It's listed in `PUBLIC_OPERATIONS`, so signed-out callers reach it without the Cognito authorizer. Its API Gateway throttle is `publicSuggestThrottle` (stage keys `publicSuggestThrottleRateLimit` and `publicSuggestThrottleBurstLimit`), not the shared `publicThrottle` the other public operations get.

## Input

```ts
SuggestCoursesInputSchema = z.object({
  // Trimmed before validation. Shorter than 3 characters is rejected.
  q: z.string().trim().min(3).max(200),
});
```

## Output

```ts
SuggestCoursesOutputSchema = z.object({
  items: z
    .array(
      z.object({
        courseId: z.string(),
        title: z.string(),
        imageKey: z.string().optional(),
      }),
    )
    .max(10),
});
```

## Behavior

| Case | Result |
|------|--------|
| Published courses match | Up to 10 items, best match first: relevance times rating boost, then newest, then `courseId` |
| Nothing matches | `{ items: [] }` |
| A draft or archived course has a matching title | Not returned. The query filters to `status: 'published'`, and such courses aren't indexed anyway |
| `q` is under 3 or over 200 characters after trimming | `BAD_REQUEST` (zod) |
| Search doesn't answer within 3 s (cold start) | `TIMEOUT`, with the message "Search is starting up. Try again in a few seconds." |
| Any other search error | `INTERNAL_SERVER_ERROR` |
| Signed in or signed out | Identical results |
| Over the stage's suggest throttle (R-6) | API Gateway answers 429 before the Lambda runs. The portal shows no suggestions and no error |

## Search request (built by `buildSuggestRequest`)

```jsonc
{
  "size": 10,
  "track_total_hits": false,
  "_source": ["courseId", "title", "imageKey"],
  "query": {
    "function_score": {
      "query": {
        "bool": {
          "must": { "match_bool_prefix": { "title": { "query": "<q>" } } },
          "filter": [{ "term": { "status": "published" } }]
        }
      },
      "field_value_factor": { "field": "ratingBoost", "missing": 1 },
      "boost_mode": "multiply"
    }
  },
  "sort": ["_score", { "publishedAt": "desc" }, { "courseId": "asc" }]
}
```

`<q>` is passed as query text, never parsed as query syntax.
