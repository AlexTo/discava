# @discava/common-branding

The platform branding rules shared by the portals and the backend: the brand document and its schema, the colour palette and contrast rules, and the image rules for the logo, icon and share image.

Import each module on its own, as with `common-web-utils`:

```ts
import { brandPalette } from '@discava/common-branding/colour';
```

## What's here

- `brand.ts`: the brand fields and document schemas, the default brand and `resolveBrand`.
- `colour.ts`: hex parsing, WCAG contrast and `brandPalette`.
- `image-rules.ts`: the rules each brand image kind must meet, and the object keys.
