# Feature Specification: Course Editor Section Menu

**Feature Branch**: `20261124-190554-course-editor-section-nav` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "In the instructor portal's course editor, each time we click one of the section links (Content, Landing page, Catalogue, Captions, Certificates, First-lesson prompt, Price, Announcements, Archived) the page scrolls and we lose track of which section we're at. Replace the row of section links with a section menu that stays on screen and shows which section you are in: a menu down the side at desktop width, a bar of section links that sticks below the portal's header at narrower widths."

**Design page**: none. This changes one screen's navigation and no data, so the portal UI rules (`packages/websites/CLAUDE.md`) are where its lasting rules go.

**Parent issue**: none. Follows User Story 10 of [the instructor portal UX fixes](../20261123-000428-instructor-portal-ux-fixes/spec.md), which added the section links this replaces.

## Context

The course editor is one long page: the course's header card, then "Course content", then the settings sections (Landing page, Catalogue, Captions, Certificates, First-lesson prompt, Price), Announcements and Archived. The instructor portal UX fixes added a row of section links under the header card, each leading to its section, with the section's name in the address after `#`.

The row sits in the page's flow. As soon as an instructor uses a link, the page scrolls to the section and the row scrolls away with the top of the page. Nothing on screen then says which section they are in or what is above and below it. To reach another section they scroll back to the top, or scroll and read headings. None of the links shows which section is current either, even while the row is still visible.

## Clarifications

### Session 2026-11-24

These were settled while specifying, each with the recommended default. The maintainer confirms or overturns them in the spec's review.

- Q: Which design replaces the row of section links? → A: A section menu that stays on screen and marks the section being read. At desktop width it is a list down the side of the editor. Below that it is the same row of links as today, stuck below the portal's header. Rejected: a stuck row at every width (nine links don't fit across a laptop screen, so the current one can scroll out of the row), and one section per tab or page (an instructor could no longer scroll the whole course or search it with the browser's find, which the UX fixes kept on purpose) (FR-001, FR-002).
- Q: From what width is the menu down the side? → A: From 1280px wide. The portal's own sidebar takes 256px from 768px up, so at 1024px a side menu would leave the settings forms about 500px. Below 1280px the stuck row is used (FR-002).
- Q: Does the address follow the section being read as the instructor scrolls? → A: No. The address changes only when a section link is used, as today. Updating it on scroll would fill Back's history and fight the "open this section's address" behaviour. The menu's mark follows the scroll; the address doesn't (FR-007).
- Q: Does the menu show anything beyond the section names? → A: Only a mark on a section that has unsaved changes, which the editor already tracks for its leave question. Signs of which sections are complete (the landing-page checklist's state) are out of scope (FR-009, Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The instructor always sees which section they are in (Priority: P1)

An instructor works through their course's settings. Whichever section they have jumped or scrolled to, the section menu is on screen and marks that section, so they know where they are and can go to any other section in one step.

**Why this priority**: This is the problem reported. Today the links leave the screen on the first jump, and none of them shows the current section.

**Independent Test**: Open the editor of a course with every section shown, at 1440px and at 375px. Use each link in turn, then scroll the page slowly from top to bottom; at each step check that the menu is visible and marks the section whose heading was passed last.

**Acceptance Scenarios**:

1. **Given** the course editor at 1440px wide, **When** it loads, **Then** a menu labelled "Course sections" is down the side of the editor, beside the sections, listing each section on the page in page order.
2. **Given** the editor at 1440px, **When** the instructor scrolls to any point on the page, **Then** the whole menu stays on screen.
3. **Given** the editor at any width below 1280px, **When** the instructor scrolls past the course's header card, **Then** the row of section links stays at the top of the page, just below the portal's header, and nothing it covers is hidden for good (a section's heading reached from a link lands below it).
4. **Given** the editor at any width, **When** the instructor uses the link for a section, **Then** that link is marked as the current one straight away, the page scrolls to the section, its heading is visible below the header and menu, focus is on the heading, and the address names the section after `#`, as today.
5. **Given** the editor, **When** the instructor scrolls without using a link, **Then** the marked link changes to the section whose heading has most recently passed the top of the visible area, and no other link is marked.
6. **Given** a smooth scroll from a link that passes other sections on the way, **When** it runs, **Then** the mark does not pass through the sections in between: it stays on the chosen section.
7. **Given** the page scrolled to its end, where the last section is too short to reach the top, **When** the menu marks a section, **Then** it marks the last section.
8. **Given** the page scrolled above "Course content" (the header card on screen), **When** the menu marks a section, **Then** "Content" is marked.
9. **Given** the row of links at 375px, wider than the screen, **When** the marked section changes to one whose link is out of the row's view, **Then** the row scrolls within itself to show it, and the page does not scroll sideways.

---

### User Story 2 - The current section is told, not only shown (Priority: P1)

A keyboard or screen-reader user moves through the editor's sections and knows which one is current, just as a sighted mouse user does.

**Why this priority**: A mark that is only a colour change leaves out the people the UI rules require the portal to serve.

**Independent Test**: With the keyboard alone, Tab into the menu and through its links, use one, and check what a screen reader reports for the marked link; check the mark is visible without colour (in greyscale).

**Acceptance Scenarios**:

1. **Given** the menu, **When** a section is marked, **Then** its link says it is the current location to assistive technology, and no other link does.
2. **Given** the menu, **When** it is shown in greyscale, **Then** the marked link is still told apart from the others by something other than colour (a bar, a weight, a fill).
3. **Given** the keyboard alone, **When** the instructor Tabs from the header card, **Then** focus reaches the menu's links in page order before the sections' controls, and each link has a visible focus ring.
4. **Given** reduced motion is asked for, **When** a link is used, **Then** the page jumps to the section without a smooth scroll, and the row of links scrolls within itself without animation.

---

### User Story 3 - Unsaved changes are visible from anywhere on the page (Priority: P2)

An instructor edits a section's form, then moves on to another section without saving. The menu marks the section left with unsaved changes, so they can find it again before leaving the editor.

**Why this priority**: The editor already asks before leaving with unsaved changes, but doesn't say where they are. With the menu always on screen, it can say so at no extra cost. It is P2 because the leave question already protects the work.

**Independent Test**: Change a field in Price without saving, scroll to Announcements, and check the menu's Price link carries the unsaved mark; save Price and check the mark goes.

**Acceptance Scenarios**:

1. **Given** a settings section with unsaved changes, **When** the menu shows, **Then** that section's link carries a visible mark and its accessible name says it has unsaved changes ("Price, unsaved changes").
2. **Given** that section's changes are saved or cancelled, **When** the menu shows, **Then** the mark is gone.
3. **Given** an announcement being written or edited and not yet posted, **When** the menu shows, **Then** the Announcements link carries the mark.
4. **Given** an archived (read-only) course, **When** the menu shows, **Then** no link carries the mark.

### Edge Cases

- **A section that isn't on the page** (no archived items, an archived course without its editing sections, captions turned off on the stage): it has no link, as today, and the menu never marks it.
- **A section that loads its own data and grows after the page loads**: the mark is worked out from where the headings are at that moment, so a section growing above the visible area doesn't leave the wrong one marked for longer than the next scroll or resize.
- **A section's address opened in a new tab**: the editor opens at that section, as today, and the menu marks it once the scroll there ends.
- **Back and Forward between two section addresses**: the page goes to the section in the address, as today, and the menu marks it.
- **The window resized across 1280px**: the menu changes between the side list and the stuck row and keeps the same section marked.
- **Text zoomed to 200% at 1440px**: the side list is taller than the screen. It scrolls within itself, so every link can be reached, and the page does not scroll sideways.
- **A very short course page** (an archived course with only Content, Certificates and Announcements): the menu still shows and marks sections, and the last-section rule (US1 scenario 7) applies.
- **The portal's own sidebar collapsed at desktop width**: the side menu still sits beside the sections; the space freed widens the sections, not the menu.
- **The editor's loading and error states**: no menu shows until the course has loaded, as today.

## Requirements *(mandatory)*

### Functional Requirements

**The menu**

- **FR-001**: The course editor MUST show a navigation landmark labelled "Course sections" with one link per section on the page, in page order, named as today ("Content", "Landing page", "Catalogue", "Captions", "Certificates", "First-lesson prompt", "Price", "Announcements", "Archived"). A section that isn't on the page MUST NOT have a link.
- **FR-002**: At widths of 1280px and above, the menu MUST be a vertical list beside the sections that stays on screen while the page scrolls. Below 1280px it MUST be a row of links that stays at the top of the page, just below the portal's header, once the page has scrolled past the course's header card.
- **FR-003**: A row of links wider than the screen MUST scroll within itself; the page MUST NOT scroll sideways at 375px. A side list taller than the screen MUST scroll within itself.
- **FR-004**: A section's heading reached from a link, from an address or from Back or Forward MUST end up fully visible below the portal's header and, below 1280px, below the stuck row.

**Marking the current section**

- **FR-005**: Exactly one link MUST be marked as current whenever the menu shows: the section whose heading most recently passed the top of the visible area below the header and menu; "Content" when no heading has yet; the last section when the page is scrolled to its end.
- **FR-006**: Using a link MUST mark it at once and keep it marked until the scroll it starts has ended, whatever sections the scroll passes.
- **FR-007**: The address MUST change only when a link is used or Back and Forward are used, as today. Scrolling MUST NOT change the address or add to the browser's history.
- **FR-008**: The marked link MUST be exposed to assistive technology as the current location, MUST be told apart from the others by more than colour, and in the row of links MUST be scrolled into the row's view when it changes. Motion MUST honour `prefers-reduced-motion`.

**Unsaved changes**

- **FR-009**: A link to a section that has unsaved changes MUST carry a visible mark and say "unsaved changes" in its accessible name. The mark MUST follow the unsaved state the editor already tracks for its leave question, and MUST go when the changes are saved, cancelled or discarded.

**Unchanged behaviour**

- **FR-010**: Everything the current section links do MUST keep working: the address after `#`, focus on the heading, opening a section's address in a new tab once the editor has loaded, and scrolling to an address once only, so a later refetch does not pull the page back.
- **FR-011**: The change MUST NOT add or change any request the portal makes; it changes only what the editor shows.
- **FR-012**: The portal UI rules (`packages/websites/CLAUDE.md`) MUST gain a rule for in-page section menus: a page long enough to need one keeps it on screen and marks the current section, so the next long page follows it.

### Key Entities

- **Section**: one part of the course editor, with an address name (`content`, `price`…), a heading, and a label in the menu. Whether it shows depends on the course (archived, has archived items) and the stage (caption translation on). Not stored; it is worked out on the page, as today.
- **Current section**: the one section the menu marks. Worked out from the scroll position, or set by using a link. Not kept in the address.
- **Unsaved section**: a section whose form has changes not yet saved, as the editor already tracks for its leave question.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 1440px and at 375px, after using any section link or scrolling to any point of the editor, the section menu is on screen and exactly one link, the right one, is marked (checked for every section of a course with every section shown).
- **SC-002**: From anywhere on the editor, any other section is one click or tap away, with no scrolling back to the top first (today: one scroll to the top and a click, or reading headings).
- **SC-003**: At 375px the page never scrolls sideways, and every menu link is at least 24px by 24px.
- **SC-004**: A reviewer using a screen reader hears which section is current and which have unsaved changes, without seeing the screen.
- **SC-005**: The editor makes the same requests before and after the change.

## Assumptions

- **Scope.** Only the course editor (`/my-courses/<course>`) changes. The other instructor pages, and the student and admin portals, are not long enough to need a menu like it. The public course landing page has its own section tabs, which are not changed here.
- **Order and content of the editor are unchanged.** "Course content" stays first under the header card, as the UX fixes decided, and every section stays on one page, so the browser's find still reaches everything.
- **The header card stays above the menu.** The menu starts beside or below the course's header card, not beside it at the top of the page, so the course's title, status and Publish controls keep the full width.
- **1280px** is the switch because the portal's sidebar is 256px wide from 768px up and the editor's sections are up to 1024px wide. The plan may move it if the layout shows a better point, and records why.
- **Out of scope: completeness marks.** Showing which sections are complete (from the landing-page checklist) would need rules for every section that don't exist yet. It is a follow-up if wanted.
- **Out of scope: sub-sections.** The menu lists sections only, not modules or lessons inside "Course content".
- **Testing.** The marking is checked by component tests and the existing phone-width and editor e2e scenarios. A reviewer checks it with a screen reader before merge, as the UI rules require.
