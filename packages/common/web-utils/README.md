# @discava/common-web-utils

Non-UI code shared by two or more of the portals (student, instructor, admin): types, pure logic and browser helpers. It's the frontend counterpart of `@discava/common-server-utils`.

Import each module on its own, as with `common-server-utils`:

```ts
import { safeReturnTo } from '@discava/common-web-utils/return-to';
```

## What's here

- `query-retry.ts`: the portals' retry rule for queries, which doesn't retry answers that can't change, like not found or forbidden (#236).
- `quiz.ts`: quiz types, and the logic both portals share for showing and answering a quiz.
- `return-to.ts`: the page to return to after signing in, kept to the portal's own paths.
- `video-player.ts`: the shared video player's speeds, keyboard shortcut mapping and saved player preferences.
- The portals' shared bootstrap: `runtime-config.ts` (context, provider and hook), `trpc-provider.ts` (`createTrpcProvider<AppRouter>()`, which each portal calls in its `src/api.ts`), `query-client.ts`, `public-media-url.ts` and `brand.ts` (`BrandProvider` and `useBrand`, the admin-set platform brand).
- Smaller shared helpers: `api-errors.ts`, `caption-languages.ts`, `discussion.ts`, `file-size.ts`, `groups.ts`, `price.ts`, `sign-out.ts` and `user-profile.ts`.
- `testing.ts`: test-only helpers the portals' tests and test setup share (`fakeTrpcFetch`, `createRenderWithApi`, `installJsdomStubs`, `mockRouter`). Never import it from portal source.

## What goes where

- **Here:** frontend code with no UI that more than one portal uses.
- **`@discava/common-shadcn`:** UI components and their styling.
- **`@discava/common-server-utils`:** code for the backend Lambdas. It's server-only, and Biome stops the portals and this package from importing it.
- **The portal itself:** code only one portal uses stays in that portal.
