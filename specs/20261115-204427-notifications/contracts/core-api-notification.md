# Contract: core-api `notification` router

All procedures use `protectedProcedure` (any signed-in user, student, instructor or admin) and work on `ctx.user.sub` only; no input carries a user id. They run on the shared router function (the table is all they need). Preference procedures and the unsubscribe route are the only places a user's preferences are written.

## Procedures

| Procedure | Type | Input | Output |
|-----------|------|-------|--------|
| `notification.list` | query | `{ limit?: 1..50 (default 20), cursor?: string }` | `{ items: Item[], nextCursor?: string, unreadCount: number }` |
| `notification.unreadCount` | query | none | `{ unreadCount: number }` |
| `notification.markRead` | mutation | `{ position: string }` | `{ unreadCount: number }` |
| `notification.markAllRead` | mutation | `{ through: string }` | `{ unreadCount: number, more: boolean }` |
| `notification.preferences` | query | none | `Preference[]` |
| `notification.setPreference` | mutation | `{ type: string, emailEnabled: boolean }` | `Preference` |

`Item`: `{ position, type, title, body, link: { portal, path }, occurredAt, read: boolean }`. `position` is the opaque sort key and is both the notification's id and what `through` takes.

`Preference`: `{ type, name, description, emailEnabled: boolean, required: boolean }`, one per registry type whose policy is not `never`, in registry order.

## Behavior

- `list` queries newest first by position. `read` is derived: `readAt` set, or position at or before `readThrough`. `cursor` is ElectroDB's cursor, opaque to clients. `unreadCount` comes from the state record in the same call.
- `unreadCount` is one keyed get; a user with no state record has 0. The portal polls it every 60 s.
- `markRead`: a position that does not exist or belongs to another user returns `NOT_FOUND` (the same for both, so existence is not leaked). Already read is a success with no write and the current count.
- `markAllRead({ through })`: `through` must be a position of the caller's own (the newest one the portal showed). Reads up to 500 items per call; `more` is true when unread items up to `through` remain, and the portal calls again. A state conflict retries up to 3 times, then `CONFLICT`.
- `setPreference` on a `required` or `never` type returns `BAD_REQUEST`; an unknown type `NOT_FOUND`. Writing the registry default is allowed (the record is simply stored).
- Errors follow the repo's `TRPCError` codes; every procedure has output validation, so a response never carries `readAt`, `email` state or another user's data.

## Public route (not tRPC)

Served by `notification-unsubscribe`, no Cognito authorizer, under the API's `publicThrottle`:

| Request | Result |
|---------|--------|
| `GET /unsubscribe/{token}` | `200 { type, name }` for a valid token (no change made); `404 { error: 'invalid' }` otherwise |
| `POST /unsubscribe/{token}` | Sets `emailEnabled: false` for the token's user and type; `200 { type, name }`. Accepts a JSON body or the form body `List-Unsubscribe=One-Click` and ignores it. Invalid token: `404`. A `required` type: `400`. Idempotent |
| `POST /unsubscribe/{token}?resubscribe=1` | Sets `emailEnabled: true`; `200` (the portal's "turn back on" button) |

CORS allows the student portal's origin (the portal calls it with fetch) and the route allows any origin for the mail client's POST. Tokens are in [events-and-email.md](./events-and-email.md#unsubscribe-token). Local: core-api's local server serves the same two methods using the same handler code.

## Tests (unit, in `procedures/notification.test.ts`, following `assignment.test.ts`)

Per procedure: authorization (another user's position is `NOT_FOUND`), the unread count after each operation, idempotent `markRead`, `markAllRead` leaving a newer notification unread and chunking at the limit, `through` validation, `setPreference` on a required type, output never carrying internal fields. Router test: `PUBLIC_OPERATIONS` is unchanged by this feature (the unsubscribe route is not a procedure).
