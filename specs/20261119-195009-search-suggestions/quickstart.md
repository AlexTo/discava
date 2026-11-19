# Quickstart: checking search suggestions

## Prerequisites

- Docker running, `pnpm i` done.
- `pnpm dev` running, which starts the student portal, core-api and local OpenSearch.
- A few published courses. Run `pnpm nx run @discava/e2e:seed-local-courses`, or publish some as an instructor in the instructor portal.

## Automated checks

```sh
pnpm nx run @discava/core-api:test -- --run suggest-query.test.ts search.test.ts router.test.ts
pnpm nx run @discava/student-portal:test -- --run site-search use-debounced-value title-highlight
pnpm nx e2e @discava/e2e -- --grep "suggestions"
```

All pass. The e2e test posts its screenshots on the PR.

## By hand (student portal, signed out)

1. Type 2 characters in "What do you want to learn?". No dropdown appears, and the browser's network panel shows no `course.publicSuggest` request.
2. Type the first 3 to 4 letters of a published course's title (for example "pyth"). After a short pause, one `course.publicSuggest` request is sent, and the dropdown lists that course with the typed letters in bold.
3. Type a long word quickly. Exactly one request is sent, after you stop.
4. Press Down twice, then Enter. The second course's page opens.
5. Type again, press Escape. The dropdown closes and the text stays.
6. Type text that matches nothing. You see "No courses match" and "See all results for '…'". Choosing the latter opens `/search?query=…`.
7. With a screen reader (VoiceOver or NVDA), type a query. The suggestion count is announced, and arrowing announces each course.
8. Archive a matching course as its instructor. Within a few seconds it no longer appears in suggestions.
9. Stop the OpenSearch container and type. Nothing errors in the top bar, and Enter still opens the results page (which shows its own error).
10. On a phone-width window (375 px), the dropdown fits without horizontal scrolling.

Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.
