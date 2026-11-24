# Contract: admin-api category operations

A new tRPC API (`@discava/admin-api`, generated). Every procedure requires the caller to be in the `admin` Cognito group, otherwise `FORBIDDEN`.

| Operation | Input | Output | Errors |
|-----------|-------|--------|--------|
| `category.list` | none | `[{ id, name, slug, status, courseCount }]`, all statuses, sorted by name | none beyond auth |
| `category.create` | `{ name }` (1 to 60 characters after trimming) | the category | `CONFLICT` when the name (ignoring case and spacing) exists, `BAD_REQUEST` on an empty or over-long name or a name with no URL-safe characters |
| `category.rename` | `{ id, name }` | the category (slug unchanged) | `NOT_FOUND`, `CONFLICT` on a taken name |
| `category.archive` | `{ id }` | the category | `NOT_FOUND`; archiving an archived category is a no-op returning it |

`courseCount` on the admin list counts every course with the category regardless of status, so an admin sees what archiving affects. Every write goes through `categoryWrites` in `core-table`; two concurrent creates of one name yield one success and one `CONFLICT`; two concurrent creates of different names that slug alike both succeed, the second with the next numeric slug suffix. A rename that changes only case or spacing patches the name and moves no claim.
