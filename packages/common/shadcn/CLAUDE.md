# common-shadcn

Shared UI for the three portals: the shadcn/ui primitives in `src/components/ui/`, Discava's own components in `src/components/`, and hooks in `src/hooks/`. Non-UI code shared by portals goes in `packages/common/web-utils` instead.

The UI rules in [`packages/websites/CLAUDE.md`](../../websites/CLAUDE.md) apply to everything here. In addition:

- A component here never imports a portal, an API package or a router. Take what you need as props (see `RouteAnnouncer`'s `pathname`, `createTrpcProvider`'s router type).
- A change here reaches all three portals. Run the tests of each portal that uses the component, not only this package's.
- Files in `ui/` are shadcn's: add them with the shadcn CLI and change them only when a rule above needs it, saying so in the pull request.
- A component that swaps one view for another moves focus to the new view itself; callers should not have to.
