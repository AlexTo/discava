# Contract: page titles

`usePageTitle(...parts)` (`@discava/common-shadcn/hooks/use-page-title`) drops empty parts, appends the platform's name ("Discava" in the table below, or the name the branding sets), and joins the parts with " · ". Each admin route calls it from its first render. No admin title depends on a request, so a page has the same title while loading, on error and loaded.

| Route | Title | `h1` |
|-------|-------|------|
| `/` | `Home · Discava` | Admin |
| `/categories` | `Categories · Discava` | Categories |
| `/reviews` | `Reviews · Discava` | Reviews |
| `/certificates` | `Certificates · Discava` | Certificates |
| `/payments` | `Payments · Discava` | Payments |
| `/settings/branding` | `Branding · Settings · Discava` | Branding |
| `/settings/notifications` | `Notification settings · Settings · Discava` | Notification settings |
| any address with no page | `Page not found · Discava` | Page not found |
| any address, signed in without the admin group | `Administrators only · Discava` | The admin portal is for administrators |

Rules:

- No route writes `document.title` any other way.
- The restricted page's title is set by a component rendered only in the restricted branch of `AdminsOnly`, never by a hook above its early return: React runs a parent's effects after its children's, so a title set there would overwrite every admin page's title on first load.
- The breadcrumb for `/settings/notifications` reads "Notification settings" (`segmentLabels.notifications`), matching the title and the `h1`.
- Branding's call changes from `usePageTitle('Branding')` to `usePageTitle('Branding', 'Settings')`, so both settings pages name their parent.
- Each page keeps one `h1` in every state: loading, error and loaded. The headings above are rendered outside the loading and error branches, as they are today.
