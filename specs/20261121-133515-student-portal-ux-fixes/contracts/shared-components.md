# Contract: shared pieces

What each shared piece promises its callers. Tests in the owning package assert these.

## `ResponsivePanel` (`@discava/common-shadcn/components/responsive-panel`), new

```ts
interface ResponsivePanelProps {
  /** The trigger's text, e.g. "Course outline", "Filters". */
  label: string;
  /** Shown beside the label, e.g. the current lesson's title, "2 active". */
  summary?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}
```

- Below the `lg` breakpoint: a full-width outline button with `label` and `summary`, `aria-expanded`, controlling the content; the content starts closed.
- At `lg` and above: no button; the content always shows, whatever `open` was.
- The switch is CSS only. No width is measured and nothing renders differently on first paint.
- The trigger is a text button with a rotating chevron, as the existing collapsibles are; `summary` truncates, `label` does not.

## `usePageTitle` (`@discava/common-shadcn/hooks/use-page-title`) and `pageTitle` (`@discava/common-web-utils/page-title`), new

```ts
pageTitle(...parts: (string | undefined | null | false)[]): string
usePageTitle(...parts: (string | undefined | null | false)[]): void
```

- `pageTitle('Projections', 'Linear Algebra')` is `"Projections · Linear Algebra · Discava"`; `pageTitle()` is `"Discava"`.
- `usePageTitle` sets `document.title` whenever the result changes. It does not restore a previous title on unmount.

## `RouteAnnouncer` (`@discava/common-shadcn/components/route-announcer`), new

```ts
interface RouteAnnouncerProps {
  /** The element that holds the page; the skip link's target. */
  containerId: string;
  /** The current pathname, from the portal's router. */
  pathname: string;
}
```

- Renders nothing, and never writes `document.title` (it is the parent of every route, so its effects run after theirs; see research R-7).
- When `pathname` changes after the first render: focuses the first `h1` inside `#containerId`, adding `tabIndex={-1}` to it, as soon as one exists (waits up to 5 seconds, and stops waiting on the next change).
- Takes the pathname as a prop, so the shared package does not import a router.
- Does nothing when only the search or hash changes, because the caller passes the pathname alone.
- The focused heading shows no focus ring (it was not reached by Tab); every interactive element keeps its ring.

## `ErrorAlert` (`@discava/common-shadcn/components/error-alert`), changed

```ts
interface ErrorAlertProps {
  type?: 'info' | 'error';
  header: React.ReactNode;
  children: React.ReactNode;
  /** Shows a button under the message that calls this. */
  onRetry?: () => void;
  /** @default "Try again" */
  retryLabel?: string;
}
```

- Without `onRetry` it renders exactly as today.
- The button is a small outline text button, `type="button"`.

## `QuizCard` (`@discava/common-shadcn/components/quiz-card`), changed

Props are unchanged. Behaviour added:

- Focus follows the phase as [data-model.md](../data-model.md) lists; never on first render.
- The score line is in a `role="status"` region.
- The question navigator's buttons are at least 24px by 24px, show the question's number, keep `aria-current="step"` on the current one and the accessible name "Question N" with ", answered" and the marker where they apply. With one question the navigator is not rendered.
- The review's submit button reads "Submit answers" ("Submitting…" while pending). When `settings.attemptsAllowed` is not null, a line above the buttons reads "This uses attempt N of M."; N is the draft's attempt number.
- In the result, an option's tick keeps its 16px size beside text of any length, and "(your answer)" does not shrink below its text's width.
- The instructor portal's quiz preview uses the same card and gets all of this.

## `apiErrorMessage` (`@discava/common-web-utils/api-errors`), changed

| Error | Message |
|-------|---------|
| no answer from the server: no `data.code`, and the error or its cause is a `TypeError`, or its message is "Failed to fetch", "Load failed" or starts with "NetworkError" | "Couldn't reach Discava. Check your connection and try again." |
| `data.code` is `INTERNAL_SERVER_ERROR`, whatever the message | "Something went wrong on our side. Try again in a moment." |
| a message written for people, any other code | the message, unchanged (as today) |
| only a code | the code's sentence (as today) |
| anything else | the `fallback` argument (as today) |

The signature does not change.
