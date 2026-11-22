# Quickstart: validating admin-set platform branding

How to show the feature works, locally and on a deployed stage. Behaviour details are in the [contracts](./contracts/) and [data model](./data-model.md); this guide only says what to run and what to expect.

## Automated checks (no local stack needed)

```sh
pnpm nx run @discava/common-branding:test -- --run          # contrast, palette, image rules, schema
pnpm nx run @discava/core-table:test -- --run platform-brand branding brand-stream stream-features
pnpm nx run @discava/admin-api:test -- --run branding
pnpm nx run @discava/events:test -- --run brand-publishing
pnpm nx run @discava/core-api:test -- --run page-renderer
pnpm nx run @discava/common-web-utils:test -- --run brand
pnpm nx run @discava/admin-portal:test -- --run branding
pnpm nx affected --target build                              # includes synth and checkov for infra
```

Expected: all pass; `synth` shows the `brand/*` behavior on the public media distribution and the `brand-publishing` Lambda in the stream router stack.

## End to end (pull request CI, or locally with `pnpm dev`)

```sh
pnpm nx e2e @discava/e2e -- branding.e2e.ts concurrency/brand-save.e2e.ts
```

Expected:
1. An admin uploads a logo, an icon and a share image, sets a unique name and a colour, and saves.
2. The student, instructor and admin portals show the logo and name in their headers, the icon as the tab icon, and primary buttons in the colour.
3. A public course landing page from the page renderer (port 2026) has the name in `<title>` and `og:site_name`, the icon link, and the colour in its inline style; an instructor profile without a photo has the share image as `og:image`.
4. Turning off "Show the name beside the logo" hides the header text but keeps the name in the title.
5. Uploading a non-square icon, or an SVG logo containing a `<script>`, is refused with a message, and the brand is unchanged.
6. A student-only user cannot open the Branding page or call `branding.save`.
7. Two saves on the same revision at once: exactly one succeeds, the other gets `CONFLICT`.
8. "Reset all to default" restores the Discava brand everywhere; the scenario then restores whatever brand it found.

## Locally by hand

1. `pnpm dev`, sign in to the admin portal (http://localhost:4202) as an admin user.
2. Settings → Branding: upload files, pick a colour, check the preview, Save.
3. Open the student portal in another tab: new page loads show the brand within a minute (the browser keeps `brand.json` for 60 s); `http://localhost:9090/discava-public-media/brand/brand.json` shows the published document.
4. Open `http://localhost:2026/learn/<a course slug>` and view source for the title, icon link and inline style.

## On a deployed stage `(human)`

1. Deploy (`pnpm nx deploy @discava/infra "discava-development/*"`), save a brand as an admin.
2. Within 5 minutes, a fresh browser profile sees the new brand in each portal and on a public page; `curl -I <media domain>/brand/brand.json` shows `cache-control: public, max-age=60, s-maxage=240` and `access-control-allow-origin: *`.
3. Replace the logo; within 5 minutes no fresh page load shows the old one.
4. Share a public course link in a social or chat app's link preview tool; the preview shows the platform name and, for a page without its own image, the share image.
5. Add the student portal to an iPhone home screen; the icon is the brand icon.
6. Open a brand SVG's URL directly; the response carries the `Content-Security-Policy` sandbox header.
