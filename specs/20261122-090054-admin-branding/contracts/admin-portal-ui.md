# Contract: admin portal Branding page

Route: `/settings/branding` in the admin portal, next to the existing `/settings/notifications`, reached from the sidebar as "Branding". Files: `admin-portal/src/routes/settings/branding.tsx`, `-components/` beside it, `-branding.test.tsx`.

## Layout

One form, then a preview, then the Save button.

| Section | Controls |
|---------|----------|
| Platform name | Text input (1–50 characters); switch "Show the name beside the logo" (on by default); "Reset to default" |
| Logo | Current logo; "Upload logo" (PNG, JPEG, WebP or SVG, up to 1 MB, 1:1 to 4:1); "Reset to default" |
| Icon | Current icon at 32 px and 192 px; "Upload icon" (PNG, square, at least 192 × 192, 512 × 512 suggested); "Reset to default" |
| Share image | Current image at 1.91:1; "Upload share image" (PNG, JPEG or WebP, at least 1200 × 630); "Reset to default" |
| Brand colour | Colour picker and a hex field; the chosen text colour and contrast ratio shown beside it; "Reset to default" |
| Preview | A portal header (logo and, if shown, name), a primary and a secondary button, a link and an active navigation item, all in the unsaved brand |
| Footer | "Last changed by <name>, <relative time>" (or "Using the default Discava brand"); "Reset all to default"; "Save" |

Buttons carry text only (no arrow icons). Every control has a visible label.

## Behaviour

- Choosing a file checks type, size and dimensions in the browser first and shows the rule it broke beside the control; a valid file uploads at once (`createUploadUrl`, then `PUT`) and appears in the preview. Nothing visitors see changes until Save.
- A colour that fails the contrast check shows the message from research R-7 and disables Save until changed.
- "Reset to default" on a section sets that field to the default in the form (preview updates); "Reset all to default" asks for confirmation in a dialog, then does the same for every field. Both take effect on Save.
- Save sends the whole form with the loaded revision. On success: a toast "Branding saved. Visitors see it within 5 minutes.", the admin portal shows the new brand at once, and the form reloads from the result. On `CONFLICT`: an error alert with a "Reload" button; the form keeps the admin's edits until they reload. On `BAD_REQUEST`: the message beside the field it names.
- Leaving the page with unsaved changes asks for confirmation.
