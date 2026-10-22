# @discava/common-portal-utils

Non-UI code shared by two or more of the portals (student, instructor, admin): types, pure logic and browser helpers. It's the frontend counterpart of `@discava/common-server-utils`.

Import each module on its own, as with `common-server-utils`:

```ts
import { safeReturnTo } from '@discava/common-portal-utils/return-to';
```

## What's here

- `quiz.ts`: quiz types, and the logic both portals share for showing and answering a quiz.
- `return-to.ts`: the page to return to after signing in, kept to the portal's own paths.

## What goes where

- **Here:** frontend code with no UI that more than one portal uses.
- **`@discava/common-shadcn`:** UI components and their styling.
- **`@discava/common-server-utils`:** code for the backend Lambdas. It's server-only, and Biome stops the portals and this package from importing it.
- **The portal itself:** code only one portal uses stays in that portal.
