# Feature Specification: Search Suggestions as You Type

**Feature Branch**: `20261119-195009-search-suggestions` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "In the search box 'What do you want to learn', when the user starts typing, show a dropdown of suggestions, up to 10 items, starting when the user types more than 3 characters. Debounce the input so the search query isn't sent to the server too quickly."

**Parent issue**: none

## User Scenarios & Testing *(mandatory)*

The student portal's top bar has a course search box on every page ("What do you want to learn?"). Today it does nothing until the visitor presses Enter, which opens the full results page (`/search?query=…`). This feature adds a suggestions dropdown under that box. It doesn't change the results page or what Enter does with no suggestion chosen.

### User Story 1 - Jump straight to a course from the search box (Priority: P1)

A visitor, signed in or not, starts typing in the search box. Once they've typed more than 3 characters, a dropdown under the box lists up to 10 published courses whose titles match what they've typed so far, including a partly typed last word ("pyth" matches "Python for Data Analysis"). Choosing one opens that course's page.

**Why this priority**: This is the feature. It saves the visitor a trip through the results page when they already know roughly which course they want.

**Independent Test**: With a few published courses in the catalogue, type the first 4 or more letters of one course's title and confirm that the course appears in the dropdown and that choosing it opens its page.

**Acceptance Scenarios**:

1. **Given** a published course titled "Python for Data Analysis", **When** the visitor types "pyth", **Then** the dropdown lists that course.
2. **Given** the visitor has typed 3 characters or fewer (after trimming spaces), **When** they pause, **Then** no dropdown appears and no suggestion request is made.
3. **Given** more than 10 published courses match, **When** the dropdown opens, **Then** it lists exactly 10, the best matches first.
4. **Given** the dropdown is open, **When** the visitor clicks or taps a suggestion, **Then** the course's page opens and the dropdown closes.
5. **Given** a course is a draft or archived, **When** its title matches what was typed, **Then** it never appears in the dropdown.
6. **Given** the visitor is signed out, **When** they type, **Then** suggestions work exactly as for a signed-in visitor.

---

### User Story 2 - Typing doesn't flood the server (Priority: P1)

While the visitor is typing, the portal waits for a short pause before asking for suggestions, so a burst of keystrokes sends one request instead of one per key. When an answer arrives for text the visitor has since changed, it's thrown away, so the dropdown never shows suggestions for older text.

**Why this priority**: The user asked for it explicitly. Without it, a fast typist sends a request per keystroke, which costs search capacity and can show results out of order.

**Independent Test**: Type a 10-character word quickly, then pause, and count suggestion requests: one is sent, for the full word.

**Acceptance Scenarios**:

1. **Given** the visitor types continuously, with no gap longer than the debounce delay, **When** they stop, **Then** exactly one suggestion request is sent, for the text as it stands after the pause.
2. **Given** a request for "javas" is still in flight, **When** the visitor changes the text to "javascript" and a newer answer arrives, **Then** the dropdown shows the answer for "javascript", even if the "javas" answer arrives later.
3. **Given** the visitor goes back to text they searched moments ago (for example, deletes a character and retypes it), **When** the pause passes, **Then** the earlier suggestions are reused without a new request.
4. **Given** the visitor presses Enter before the pause passes, **When** the results page opens, **Then** no suggestion request is sent for the text that was submitted.

---

### User Story 3 - Use the dropdown from the keyboard and with a screen reader (Priority: P2)

A visitor who uses only the keyboard moves through the suggestions with the arrow keys, opens one with Enter and closes the dropdown with Escape. A screen reader announces that suggestions are available, how many there are, and which one is highlighted.

**Why this priority**: The search box is in the top bar on every page, so it has to be fully usable without a mouse. It's P2 only because it builds on the dropdown in Story 1.

**Independent Test**: With the keyboard only, type a query, arrow down to the third suggestion and press Enter: the third course's page opens. Repeat with a screen reader and confirm the count and the highlighted item are announced.

**Acceptance Scenarios**:

1. **Given** the dropdown is open, **When** the visitor presses Down or Up, **Then** the highlight moves through the suggestions, and the text in the box stays what they typed.
2. **Given** a suggestion is highlighted, **When** the visitor presses Enter, **Then** that course's page opens.
3. **Given** no suggestion is highlighted, **When** the visitor presses Enter, **Then** the full results page opens for the typed text, as it does today.
4. **Given** the dropdown is open, **When** the visitor presses Escape or moves focus out of the search box, **Then** the dropdown closes and the typed text stays.
5. **Given** suggestions arrive, **When** a screen reader is running, **Then** it announces how many suggestions there are (or that there are none) without moving focus out of the box.

---

### User Story 4 - See every result from the dropdown (Priority: P3)

The last row of the dropdown is "See all results for '<text>'", which opens the full results page, the same as pressing Enter. It's always there, even when no course matches.

**Why this priority**: It tells the visitor that the dropdown is a shortcut and isn't the whole search, and gives mouse and touch users a way to get to the results page. Enter already does this, so it's the lowest priority.

**Independent Test**: Type a query and choose "See all results": the results page opens for that query.

**Acceptance Scenarios**:

1. **Given** the dropdown is open, **When** the visitor chooses "See all results for '<text>'", **Then** `/search?query=<text>` opens.
2. **Given** no published course matches, **When** the dropdown opens, **Then** it says no courses match and still offers "See all results".

---

### Edge Cases

- **Leading or trailing spaces**: these don't count toward the more-than-3-characters threshold, and aren't sent.
- **Text shortened to 3 characters or fewer**: the dropdown closes and any request still in flight is ignored.
- **Search is cold-starting**: on a stage where search scales to zero, the first request can time out while search starts up. The dropdown shows nothing or a short "Suggestions are loading" state, never an error banner. Typing and Enter keep working.
- **Search unavailable or request fails**: the dropdown stays closed or shows no suggestions. The failure doesn't block typing, Enter, or the results page.
- **Slow answer**: while a request is in flight for the current text, the dropdown keeps showing the previous suggestions or a loading state, never an empty list as if nothing matched.
- **On the results page**: the box shows the current query, as it does today. The dropdown opens only after the visitor edits the text, not when the page loads with the query already filled in.
- **Very long text**: text longer than the search box accepts today (200 characters) asks for no suggestions.
- **Special characters and other scripts**: punctuation, emoji and non-Latin text never cause an error. They just match what they match.
- **Small screens**: the dropdown fits the viewport width without horizontal scrolling, and each suggestion is a comfortable tap target.
- **Course unpublished after the suggestion was shown**: choosing it opens the course page, which shows "course not found" as it does today for a course that isn't published.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The search box MUST show a suggestions dropdown once the trimmed text is more than 3 characters long (4 or more), and MUST NOT ask for suggestions at 3 characters or fewer.
- **FR-002**: The dropdown MUST list at most 10 course suggestions, ordered best match first.
- **FR-003**: Suggestions MUST match a course whose title contains every typed word, with the last word matched as a prefix (so a partly typed word still matches). Matching MUST ignore case and use the same word stemming the full search uses.
- **FR-004**: Suggestions MUST include only published courses, enforced where the suggestions are produced and not only in the portal, the same way full search enforces it.
- **FR-005**: Each suggestion MUST show the course title, and its image when it has one, and MUST make the part of the title that matched stand out visually.
- **FR-006**: Choosing a suggestion (click, tap, or Enter while highlighted) MUST open that course's page in the student portal.
- **FR-007**: The portal MUST wait until the visitor has stopped typing for a debounce delay of 300 ms before asking for suggestions, and MUST send at most one request per pause.
- **FR-008**: The portal MUST ignore any answer for text other than what's currently in the box.
- **FR-009**: The portal MUST reuse recent answers for text it already asked about in the same visit instead of asking again.
- **FR-010**: Pressing Enter with no suggestion highlighted MUST keep today's behavior (open the results page for the typed text) and MUST cancel any pending suggestion request.
- **FR-011**: The dropdown MUST support the keyboard (Up/Down to move, Enter to choose, Escape to close) and MUST close when focus leaves the search box.
- **FR-012**: The search box and dropdown MUST follow the accessible combobox pattern: assistive technology is told that suggestions exist, how many there are, and which one is highlighted, without focus leaving the box.
- **FR-013**: The dropdown MUST end with a "See all results for '<text>'" entry that opens the results page, and MUST say "No courses match" when nothing matches.
- **FR-014**: A failed or timed-out suggestion request MUST NOT show an error, block typing, or affect Enter and the results page.
- **FR-015**: Suggestions MUST be available to signed-out visitors, under the same request limits and protections as today's public search.
- **FR-016**: A suggestion request MUST return only what the dropdown shows (identifier, title, image), not full result data such as facets or counts.
- **FR-017**: Suggestions MUST work in local development with no AWS account, against the same local search the results page uses.

### Key Entities

- **Suggestion**: one course offered in the dropdown: the course's identifier, its title, its image if it has one, and which part of the title matched. It's derived from the same search index the results page uses; nothing new is stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With search warm, suggestions appear within 1 second of the visitor pausing, for 95% of pauses.
- **SC-002**: Typing a 10-character word continuously, then pausing, results in exactly 1 suggestion request.
- **SC-003**: Suggestions never show text older than what's in the box: in a test where an older answer arrives after a newer one, the dropdown shows the newer one 100% of the time.
- **SC-004**: No draft or archived course appears in suggestions, checked against every course state in tests.
- **SC-005**: A keyboard-only visitor can go from an empty box to a chosen course page using only typing, arrow keys and Enter.
- **SC-006**: When suggestion requests fail, typing and submitting the search box still work, with no visible error.

## Assumptions

- "More than 3 characters" means 4 or more characters after trimming spaces, taken literally from the request.
- Suggestions are course titles only. Categories, tags, instructors, lessons and past searches are out of scope (see the Search design page's v1 scope: courses only).
- A suggestion opens the course's page directly. The full results page stays the way to see every match, with filters.
- 300 ms is the debounce delay, a common default for search-as-you-type that feels instant without sending a request per keystroke.
- Suggestions respect no filters: they search the whole published catalogue even when the visitor is on the results page with filters selected.
- Only the student portal has this search box; the instructor and admin portals are out of scope.
- No search history or analytics of what visitors type is recorded.
- It reuses the existing course search index and the indexing pipeline that keeps it in sync, and nothing new is written to the core table.
