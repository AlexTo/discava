# Contract: portal UI

## Shared `NotificationBell` (`common-shadcn`)

Presentational; the portal's `components/NotificationBell.tsx` supplies data from core-api (`notification.unreadCount`, `notification.list`, `markRead`, `markAllRead`).

Props: `unreadCount`, `items` (`Item[]`), `isLoading`, `isError`, `hasMore`, `onOpenChange(open)`, `onSelect(item)`, `onMarkAllRead()`, `onLoadMore()`, `onRetry()`.

| State | What the user sees |
|-------|--------------------|
| Closed, none unread | Bell icon, no badge |
| Closed, unread | Badge with the count, "99+" above 99; the button's accessible name says how many are unread |
| Open, loading | Skeleton rows |
| Open, empty | "You're all caught up." |
| Open, items | Newest first; unread rows bold with a dot (not colour alone); title, body (two lines), relative time with the exact time on hover; a text button "Mark all as read" (disabled when none unread); a text button "Load more" when `hasMore` |
| Open, error | A short error with a "Try again" text button |

The bell is an icon-only button (allowed); "Mark all as read", "Load more" and "Try again" are text buttons, with no arrow icons.

Behavior in the portal wiring: the count polls every 60 s and refetches on window focus; the list loads when the popover opens. Selecting an item calls `markRead(position)` (unless already read) then navigates to the item's link: same-portal paths with the router, another portal's path as a full link using the runtime config's `portals` map. "Mark all as read" sends the newest shown item's `position` as `through`, repeating while `more` is true. Both mutations update the cached count optimistically and refetch on error.

Placement: the student portal's `SiteLayout` header (signed in only, beside My Learning), and the instructor and admin portals' app layouts' header or sidebar header.

## Settings page (all three portals): `/settings/notifications`

Lists `notification.preferences`: each row has the type's name, description and an email switch; a `required` row is shown as "Always on" with the switch disabled. Changing a switch calls `setPreference` and shows a saved state or an error with the switch reverted. Linked from the user menu ("Notification settings"). Needs sign-in like other portal pages.

## Unsubscribe page (student portal only): `/unsubscribe?token=...`

Public (no sign-in). On load it calls `GET /unsubscribe/{token}`.

| State | What the user sees |
|-------|--------------------|
| Loading | Spinner |
| Valid | "Stop <type name> emails?" with a text button "Stop these emails" |
| Done | "You won't get <type name> emails any more." with text buttons "Turn them back on" and "Notification settings" |
| Turned back on | "<type name> emails are back on." |
| Invalid | "This link is not valid." with a link to the portal's home |
| Error | A short error with "Try again" |

Opening the link changes nothing; only the button does.

## Tests

Component tests (Testing Library): the bell's states, badge text including "99+", mark-all choosing the newest shown position, selecting a read item not calling `markRead`; the settings rows including a required row; the unsubscribe page's states. Portal wiring tests use the renderWith-core-api helper pattern from CONTRIBUTING. Screenshots of the key steps go in `tmp/screenshots/pr-<number>/` by a `(human)` check.
