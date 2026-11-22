# Contract: shared pieces

What this feature needs from `packages/common/shadcn`. It adds one optional prop and nothing else; the rest it uses as they are, or as the instructor-portal UX spec ("IP") changes them. Their promises are in [IP's contract](../../20261123-000428-instructor-portal-ux-fixes/contracts/shared-components.md).

## Changed here

### `CognitoAuth` (`components/cognito-auth.tsx`)

```ts
interface CognitoAuthProps {
  // …existing props…
  /** Shown while signing in or redirecting to sign in. Default: a bare Spinner, as today. */
  fallback?: React.ReactNode;
}
```

- `fallback` replaces the `<Spinner />` returned while `autoSignIn` redirects or `auth.isLoading` without a navigator. Nothing else changes.
- With no `fallback`, the output is what it is today, so the student and instructor portals don't change until they pass one. IP T037 needs the same wait in words for the instructor portal; whichever task lands first adds this prop.

## Used as they are (on `main` since #892)

| Piece | Used for |
|-------|----------|
| `PendingButton` | every button whose action runs (research R-7) |
| `useReturnFocus` | every dialog opened from state (R-8) |
| `StatusMessage` | one per screen, for the result of each action (R-9) |
| `LoadingState` | every wait for a page or a section (R-6) |
| `ErrorAlert` (`onRetry`, `type="info"`) | every failed load, and the certificate not-found message (R-11) |
| `usePageTitle`, `useBreadcrumbLabel` | titles (R-6) and the not-found page's crumb (R-5) |

## Used once IP changes them

| Piece | IP task | What the admin portal gets |
|-------|---------|----------------------------|
| `PortalShell` breadcrumbs | T016 | "Home", "Settings" as text (A-04, A-05) |
| `PortalShell` + `RouteAnnouncer` | T032 | focus on the `h1` after navigation (A-02) |
| `PortalShell` phone sidebar | T040 | closes on navigation, focus back on Escape (A-03) |
| `useDiscardGuard` | T051 | Remove review and Revoke ask before discarding (C-04, D-04) |
| `useUnsavedChangesGuard` | T052 | Branding's leave question (F-04) |
| `NotificationPreferences` errors | T059 | no "Failed to fetch" (F-01) |
| `ui/dialog.tsx` close button, `ui/switch.tsx` hit area | T073 | 24px targets (C-09, F-02, F-08) |
| `NotificationPreferences` labels | T074 | a switch's text toggles it (F-02) |
