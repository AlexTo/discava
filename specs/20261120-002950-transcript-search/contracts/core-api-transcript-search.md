# Contract: `transcript.search` (core-api)

A signed-in tRPC **query** on the core API, built on a new `courseSearchProcedure` (`protectedProcedure` with the search plugin and the core-table plugin, in `src/init.ts`). It is **not** in `PUBLIC_OPERATIONS`: API Gateway's Cognito authorizer applies, with the stage's default throttle.

## Input

```ts
TranscriptSearchInputSchema = z.object({
  courseId: z.string().min(1),
  // Trimmed before validation.
  q: z.string().trim().min(2).max(200),
  // The learner's caption language (a BCP 47 tag), when they have chosen one.
  language: z.string().min(2).max(35).optional(),
});
```

## Output

```ts
TranscriptSearchOutputSchema = z.object({
  items: z
    .array(
      z.object({
        moduleId: z.string(),
        moduleTitle: z.string(),
        lessonId: z.string(),
        lessonTitle: z.string(),
        contentItemId: z.string(),
        itemTitle: z.string(),
        // Start of the caption line holding the first match, in whole seconds.
        startSeconds: z.number().int().min(0),
        language: z.string(),
        // The text around the match. Joining the parts' text gives plain text.
        snippet: z.array(z.object({ text: z.string(), match: z.boolean() })),
      }),
    )
    .max(20),
  // More moments matched than are listed.
  hasMore: z.boolean(),
});
```

No track key, file URL, `versionId` or `trackId` is returned.

## Steps

1. In parallel: every page of `collections.curriculum({ courseId })`, and `getEnrolment(coreTable, courseId, ctx.user.sub)`.
2. No course: `NOT_FOUND`. Then `requireEnrolment(course, enrolment)`.
3. `watchableVideos(curriculum)` (new, `helpers/transcript-access.ts`): `filterEffectivelyVisible`, keep items with `type === 'video'` and a `playableVersion`, and give for each `{ contentItemId, moduleId, lessonId, versionId, trackIds }` from `tracksForPlayback`. Items with no track are left out.
4. Empty set: return `{ items: [], hasMore: false }` without calling OpenSearch.
5. Search with `buildTranscriptSearchRequest` (below), with an 8 s request timeout.
6. Drop hits whose `contentItemId` isn't in the set, or whose `versionId` or `trackId` isn't that item's.
7. For each hit, find the first highlighted match, map its offset to a cue through `cues`, and build the snippet (`helpers/transcript-snippet.ts`).
8. Drop repeats with the same `contentItemId`, `trackId` and cue start. Keep the first 20. `hasMore` is true when more than 20 were left, or when 40 hits came back.
9. Titles come from the curriculum read in step 1.

## Behavior

| Case | Result |
|------|--------|
| Enrolled (`active` or `completed`), moments match | Up to 20 items, best match first, then earlier in the video |
| Nothing matches, or the course has no watchable captioned video | `{ items: [], hasMore: false }` |
| Signed out | 401 from the authorizer; `UNAUTHORIZED` locally |
| No such course | `NOT_FOUND` |
| Not enrolled, or enrolment `dropped`, course published | `FORBIDDEN`, "Enrol in the course to view it" |
| Not enrolled, course draft or archived | `NOT_FOUND` |
| Enrolled, course archived | Works |
| A video, its lesson or its module hidden or archived | No item from it, whatever the index holds |
| A video being replaced | Items only from the version still playing |
| A track removed or replaced a moment ago | No item from the old track |
| `q` under 2 or over 200 characters after trimming | `BAD_REQUEST` (zod) |
| `language` the video has no track in | That video's default track is searched |
| Search doesn't answer within 8 s | `TIMEOUT`, "Search is starting up. Try again in a few seconds." (`mapSearchError`, shared with course search) |
| Any other search error | `INTERNAL_SERVER_ERROR` |

## Search request (built by `buildTranscriptSearchRequest`)

`buildTranscriptSearchRequest({ courseId, contentItemIds, q, language })`, in `helpers/transcript-query.ts`:

```jsonc
{
  "size": 40,
  "track_total_hits": false,
  "_source": ["contentItemId", "versionId", "trackId", "language", "text", "cues"],
  "query": {
    "bool": {
      "filter": [
        { "term": { "courseId": "<courseId>" } },
        { "terms": { "contentItemId": ["<watchable ids>"] } },
        // With a language:
        {
          "bool": {
            "should": [
              { "term": { "language": "<language>" } },
              {
                "bool": {
                  "filter": [{ "term": { "isDefault": true } }],
                  "must_not": [{ "term": { "trackLanguages": "<language>" } }]
                }
              }
            ],
            "minimum_should_match": 1
          }
        }
        // Without one: { "term": { "isDefault": true } }
      ],
      "must": {
        "multi_match": {
          "query": "<q>",
          "fields": ["text", "text.english"],
          "type": "most_fields",
          "operator": "and"
        }
      },
      "should": [{ "match_phrase": { "text": { "query": "<q>", "slop": 2 } } }]
    }
  },
  "highlight": {
    "number_of_fragments": 0,
    "pre_tags": [""],
    "post_tags": [""],
    "fields": { "text": {}, "text.english": {} }
  },
  "sort": ["_score", { "startSeconds": "asc" }, { "contentItemId": "asc" }]
}
```

`<q>` is passed as query text, never parsed as query syntax. Every filter value is built by the procedure from the table, apart from `language`, which can only choose between tracks of videos already in the set.

## Snippet (built by `transcriptSnippet`)

- Input: the highlighted `text` (or `text.english` when `text` has no match), and `cues`.
- The plain text is the highlighted text with the two tag characters removed. Match ranges are the tagged spans.
- `startSeconds` is `Math.floor` of the `s` of the last cue whose `o` is at or before the first match's offset.
- The snippet is at most 240 characters around the first match, cut at word boundaries, with "…" where text was cut, as `{ text, match }` parts. Every match inside the window is marked.
- A hit with no highlight (it shouldn't happen) starts at the passage's first cue with an unmarked snippet.

## Reuse by #289

`watchableVideos` and `buildTranscriptSearchRequest` are exported from their helper files so a later retrieval procedure can scope them to a lesson (`contentItemIds` narrowed to that lesson's) with the same access rule. Nothing else is built for it here.
