# Data Model: Admin-Set Platform Branding

## Entity: `platformBrand` (core table, new)

The deployment's one brand. A singleton: the record is absent until the first save, and absence means every part is the default. Defined in `packages/databases/core-table/src/entities/platform-brand.ts`, registered in `entities/index.ts` and `service.ts`, and written only by `helpers/platform-brand.ts`.

| Attribute | Type | Required | Rules |
|-----------|------|----------|-------|
| `pk` | string | yes | constant (composite `[]`), entity-prefixed by ElectroDB |
| `sk` | string | yes | constant (composite `[]`) |
| `name` | string | no | trimmed, 1–50 characters; absent → default name "Discava" |
| `showNameBesideLogo` | boolean | yes | default `true` (FR-007a) |
| `colour` | string | no | `#rrggbb`, lower case; must pass `brandPalette` (contrast ≥ 4.5:1 with one text colour); absent → neutral theme |
| `logoKey` | string | no | matches `brand/logo/{nonce}.{png,jpg,webp,svg}`; absent → default logo |
| `iconKey` | string | no | matches `brand/icon/{nonce}.png`; absent → each portal's `favicon.ico` |
| `shareImageKey` | string | no | matches `brand/share-image/{nonce}.{png,jpg,webp}`; absent → `og-default.png` |
| `revision` | number | yes | `1` on create, `+1` on every save; condition of every update |
| `changedBy` | string | yes | Cognito `sub` of the admin who saved |
| `changedByName` | string | yes | that admin's display name at the time, for FR-013 |
| `changedAt` | string (ISO 8601) | yes | time of the save |
| `createdAt`, `updatedAt` | string | yes | ElectroDB timestamps, as other entities |

A reset (FR-011) is a save that removes the attribute; "reset all" removes all five optional attributes and sets `showNameBesideLogo` back to `true`. The record itself is never deleted, so `revision` keeps counting.

### Access patterns

| # | Pattern | Who | Key / index |
|---|---------|-----|-------------|
| AP-1 | Get the brand | admin-api `branding.get` / `save`, page renderer, `brand-publishing` handler | `get({})` on the constant primary key |
| AP-2 | Create the brand if none exists | admin-api `branding.save` with `expectedRevision: 0` | `create` (condition: key not exists) |
| AP-3 | Update the brand if unchanged since loaded | admin-api `branding.save` | `patch({}).set(…).remove(…)` where `revision = expected` |

No index and no scan. Invariant checks read the record in their existing table snapshot (tooling, not a user request).

### Helpers (`core-table/src/helpers/platform-brand.ts`)

- `getBrand(coreTable): Promise<PlatformBrandRecord | undefined>`
- `saveBrand(coreTable, { expectedRevision, changes, changedBy, changedByName }): Promise<PlatformBrandRecord>`: validates `changes` with `@discava/common-branding` (name length, colour palette, key shapes), then AP-2 or AP-3. Throws `BrandConflictError` on a failed condition and `BrandValidationError` on a bad value. Does not touch S3: attaching and detaching images is the caller's job (admin-api), as with course images.

### State

```text
(absent) --save(expectedRevision 0)--> revision 1 --save(expectedRevision n)--> revision n+1 ...
           any save with a stale expectedRevision --> BrandConflictError, record unchanged
```

## Brand image (S3 object, not a table record)

Objects in the public media bucket under `brand/{kind}/{nonce}.{ext}`. Immutable once written: a replacement is a new key. Tagged `lifecycle=unattached` from upload until `branding.save` attaches it; tagged again when a later save replaces it, after which the bucket's lifecycle rule deletes it within a day. Rules per kind are in [research.md R-8](./research.md#r-8-validating-brand-images-including-svg).

## Brand document (`brand/brand.json`, published, not a table record)

The public projection of `platformBrand` that the portals fetch. Written only by the `brand-publishing` handler from the current record. Schema `BrandDocumentSchema` in `@discava/common-branding/brand`; contract in [contracts/brand-document.md](./contracts/brand-document.md). Contains no `changedBy` / `changedByName`: who saved is shown to admins only.

## Shared records touched (constitution IV impact check)

| Record | Use | Existing invariants and tests | What changes |
|--------|-----|-------------------------------|--------------|
| `platformBrand` (new) | Written by admin-api through `saveBrand`; read by the page renderer and `brand-publishing` | none yet | New check `platform-brand-shape` in `helpers/invariants/branding.ts`: optional fields within their rules (name length, colour passes `brandPalette`, each key matches its kind's pattern), `revision ≥ 1`, `changedBy`/`changedAt` present. A breaking test for each rule. `snapshot.ts` reads the entity |
| Stream features (`STREAM_FEATURES`) | New registration `brand-publishing`, filtered to `platformBrand` inserts and modifications | `stream-features.test.ts` and each feature's `*-stream.test.ts` | New `brand-stream.test.ts`; `stream-features.test.ts` asserts `platformBrand` records route only to `brand-publishing` and no other feature's filters match them |
| `course`, `instructorProfile`, `certificate` | Read by the page renderer as today | unchanged | None; only the brand around them changes |

No other shared record is written or read in a new way.
