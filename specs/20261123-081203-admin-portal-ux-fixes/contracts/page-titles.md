# Contract: page titles

`usePageTitle(...parts)` (`@discava/common-shadcn/hooks/use-page-title`) drops empty parts, appends "Discava", and joins the parts with " · ". Each admin route calls it from its first render. No admin title depends on a request, so a page has the same title while loading, on error and loaded.

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
- Branding's call changes from `usePageTitle('Branding')` to `usePageTitle('Branding', 'Settings')`, so both settings pages name their parent.
- Each page keeps one `h1` in every state: loading, error and loaded. The headings above are rendered outside the loading and error branches, as they are today.
