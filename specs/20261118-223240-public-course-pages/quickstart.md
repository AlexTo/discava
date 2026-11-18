# Quickstart: validate public landing pages and instructor profiles

These are manual and CI validation steps. Contracts: [core-api-public](./contracts/core-api-public.md), [instructor-api-landing](./contracts/instructor-api-landing.md), [page-renderer](./contracts/page-renderer.md), [infra](./contracts/infra.md), [portal-ui](./contracts/portal-ui.md).

## Automated (an agent or CI runs these)

```sh
pnpm nx run @discava/core-table:test -- --run           # helpers, invariants and breaking tests
pnpm nx run @discava/core-api:test -- --run             # publicView, previewVideoUrl, instructorProfile.publicView, renderer, sitemap, escaping
pnpm nx run @discava/instructor-api:test -- --run       # updateLanding, profile.*, create/deletePermanently changes
pnpm nx run @discava/common-constructs:test -- --run    # SPA rewrite function, renderer behaviors, snapshots
pnpm nx run @discava/infra:test -- --run                # stage config, Data grants, synth
pnpm nx affected --target build                         # includes synth and checkov
```

Pull request CI then runs `pnpm nx e2e @discava/e2e` with `src/scenarios/public-landing-page.e2e.ts`.

## Local, by hand (human)

Prerequisites: Docker running, then `pnpm dev`.

1. Sign in to the instructor portal as Alice. Open a course with a video lesson and, on **Landing page**:
   - add 3 outcomes and 2 requirements;
   - choose the video as the preview;
   - save, and check that the checklist ticks outcomes, requirements and preview.
2. Publish the course if it is a draft. Open **Public profile**, set a headline, a bio and a photo, and save.
3. Signed out, in a private window, open `http://localhost:4201/learn/<courseId>` (student portal), and check:
   - outcomes, requirements, the facts and the instructor card are shown;
   - the preview plays with captions;
   - "View profile" opens `/instructors/<handle>` with the course listed.
4. Check what crawlers get:

   ```sh
   curl -si http://localhost:2026/learn/<courseId> | head -40   # 200, X-Robots-Tag: noindex (local is closed to search engines), title, og:*, ld+json
   curl -s  http://localhost:2026/learn/<courseId> | grep -c "<li"   # outline and outcomes present without JS
   curl -si http://localhost:2026/learn/<draftCourseId> | head -5  # 404, noindex
   curl -s  http://localhost:2026/sitemap.xml                    # course, profile and category URLs
   curl -s  http://localhost:2026/robots.txt                     # Disallow: / (search engine indexing off)
   ```

5. Archive the course. `curl` the renderer again and check for a 404 (locally there is no CDN cache, so this is immediate). Open the student portal address as Alice, who is enrolled, and check that it shows "Course not found" and that My Learning still opens the course.
6. Save screenshots to `tmp/screenshots/pr-<number>/` (`01-landing-page.png`, `02-preview-playing.png`, `03-profile.png`, `04-instructor-landing-card.png`, `05-profile-editor.png`).

## Deployed stage, by hand (human, before merge)

1. Deploy `discava-development`. Run `curl -si https://<portal>/learn/<courseId>` and check for a 200 with real content and `X-Robots-Tag: noindex`, and that `curl -si https://<portal>/learn/<unknown>` returns a real 404 (not a 200 shell).
2. Run `curl -si https://<portal>/my-learning` and check for a 200 `index.html` (the SPA rewrite works), and that `curl -si https://<portal>/assets/missing.js` does **not** return `index.html`.
3. Paste a course URL into two link-preview tools or apps (for example Slack and LinkedIn Post Inspector) and check the title, description and image (SC-006).
4. Check for Course data in Google's Rich Results Test (paste the HTML from `curl`, since the stage is `noindex`).
5. Edit the course title, then confirm that `curl` shows the change within 5 minutes. Archive the course and confirm a 404 within 5 minutes (SC-003).
6. Check that a hard reload of a landing page shows no visible jump from the static content to the interactive page (FR-012).
