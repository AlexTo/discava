# Contract: admin-api `branding` router

All procedures use `adminProcedure` (Cognito group `admin`; others get `FORBIDDEN`, anonymous callers `UNAUTHORIZED`). Schemas live in `admin-api/src/schema/branding.ts`, built from `@discava/common-branding`.

## `branding.get` (query)

Input: none.

Output:

```ts
{
  brand: {
    name: string | null;              // null → default
    showNameBesideLogo: boolean;
    colour: string | null;            // '#rrggbb'
    logoKey: string | null;
    iconKey: string | null;
    shareImageKey: string | null;
  };
  revision: number;                   // 0 when nothing has been saved yet
  changed: { by: string; byName: string; at: string } | null;
}
```

## `branding.createUploadUrl` (mutation)

Input:

```ts
{
  kind: 'logo' | 'icon' | 'share-image';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  contentLength: number;              // bytes
}
```

Refuses (`BAD_REQUEST`, message naming the rule) a content type not allowed for the kind, or a length over the kind's limit (research R-8).

Output: `{ key: string; uploadUrl: string; headers: Record<string, string> }`. The browser `PUT`s the file to `uploadUrl` with exactly `headers` (content type, length, cache control, tagging) within 15 minutes.

## `branding.save` (mutation)

Input: the whole brand the admin wants, plus the revision they loaded.

```ts
{
  expectedRevision: number;           // from branding.get, 0 if none
  name: string | null;
  showNameBesideLogo: boolean;
  colour: string | null;
  logoKey: string | null;
  iconKey: string | null;
  shareImageKey: string | null;
}
```

Behaviour, in order:

1. Validate the fields: name 1–50 characters after trimming; colour `#rrggbb` that `brandPalette` accepts; each key matches its kind's pattern. Any failure: `BAD_REQUEST`.
2. For each key that differs from the stored one: read the object, check type, size and shape against its kind's rules, and for an SVG logo the allow-list (research R-8). A missing object or a broken rule: `BAD_REQUEST` naming the image and the rule. Nothing is written.
3. Attach each new key (remove `lifecycle=unattached`).
4. `saveBrand` with `expectedRevision`. A stale revision: `CONFLICT`, message "Someone else changed the branding. Reload to see their changes." The newly attached objects are detached again (best-effort).
5. Best-effort detach of each key the save replaced or removed.

Output: the same shape as `branding.get`, for the saved brand.

Resets (FR-011) are saves with the field set to `null` (or `showNameBesideLogo: true`).

## Errors

| Case | Code |
|------|------|
| Not signed in | `UNAUTHORIZED` |
| Not an admin | `FORBIDDEN` |
| Bad field, bad or missing image | `BAD_REQUEST` (message names the rule) |
| Stale `expectedRevision` | `CONFLICT` |
