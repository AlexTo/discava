# Feature Specification: Public Course Landing Pages and Instructor Profiles

**Feature Branch**: `20261118-223240-public-course-pages` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Public course landing pages and instructor profiles (GitHub issue #287). Why: organic traffic needs SEO-friendly, shareable pages with a promo video and clear outcomes. Scope: public (unauthenticated) course page with preview video, 'what you'll learn', requirements, curriculum outline, rating, instructor card; public instructor profile (bio, photo, courses); meta/Open Graph tags; consider prerendering or edge rendering for crawlers. Acceptance: draft/archived courses are never exposed; page renders meaningful HTML for crawlers."

**Parent issue**: #287

## Clarifications

### Session 2026-11-18

Resolved without asking, using the recommended answers below (non-interactive run).

- Q: Which deployed stages may search engines index? → A: Only stages whose config turns indexing on, which by default is `discava-production` alone. Every other stage (and local dev) answers with a do-not-index marker on every page and a robots file that disallows everything, so a development stage never competes with production in search results.
- Q: Can an instructor keep themselves off public pages? → A: No. Every instructor of a published course is shown on its landing page, and their profile is public while they teach one. Teaching a published course is a public act on every course marketplace; an opt-out would leave landing pages without a teacher.
- Q: How is anonymous preview playback kept from opening up the rest of a course? → A: An anonymous playback address covers only the preview item's own renditions and caption tracks, lasts no longer than an enrolled student's, and is issued only while the item is the course's preview. Anonymous requests for it are rate-limited per client like the other public procedures.
- Q: What does an enrolled student see at an archived course's landing address? → A: The same "course not found" page as everyone else, as today. They reach the archived course from My Learning and the course home, which are unchanged; the public address never shows an archived course.
- Q: Does publishing require outcomes, requirements or a preview? → A: No. The instructor portal shows a short "landing page" checklist (outcomes, requirements, preview, image, profile) on the course, but it never blocks publishing.

## User Scenarios & Testing *(mandatory)*

The student portal already has a course page anyone can open (`/learn/<courseId>`): title, image, description, module and lesson outline, ratings and reviews, and the enrol action. It is drawn in the browser, so a search engine or a link preview sees an empty page, and it has no outcomes, requirements, preview video or instructor. This feature turns that page into the course's landing page and adds instructor profiles; it does not add a second course page.

### User Story 1 - Decide whether to take a course from its landing page (Priority: P1)

A visitor, signed in or not, opens a published course's page from a search result, a shared link or the catalogue. Before enrolling they see what they will learn, what they need beforehand, the course's key facts (level, language, estimated hours, module and lesson count), the curriculum outline, its rating and reviews, and who teaches it.

**Why this priority**: These are the facts people judge a course by on every major course marketplace, and the page they live on is what the other stories make findable and shareable.

**Independent Test**: As an instructor, add three outcomes and two requirements to a published course. Signed out, open its page and check the outcomes, requirements, key facts, outline, rating and instructor card all show. Open a course with none of the new fields set and check the page still reads well, with the empty sections left out.

**Acceptance Scenarios**:

1. **Given** a published course with outcomes and requirements, **When** a visitor opens its page, **Then** they see a "What you'll learn" list, a "Requirements" list, the key facts, the curriculum outline, the rating summary and reviews, and an instructor card for each of its instructors.
2. **Given** a published course with no outcomes or no requirements, **Then** that section is not shown (no empty heading), and the rest of the page is unchanged.
3. **Given** a course that is a draft, archived, or does not exist, **When** anyone opens its page (including a student enrolled in the archived course), **Then** they get the same "course not found" page, and nothing on it reveals whether the course exists.
4. **Given** a module or lesson the instructor has hidden, **Then** it does not appear in the outline.
5. **Given** a student already enrolled, **When** they open the page, **Then** they see the same landing page with their existing "go to course" action.

---

### User Story 2 - Watch a preview before enrolling (Priority: P1)

An instructor picks one of the course's own videos as its preview. A visitor, signed in or not, plays it from the top of the landing page without enrolling. Every other video in the course stays enrolled-only.

**Why this priority**: The issue names the preview video, and it is the strongest single signal on a landing page. Choosing an existing course video reuses the video and caption pipeline already built.

**Independent Test**: As an instructor, choose a ready video as the preview. Signed out, play it from the landing page with captions. Ask for any other video of the course signed out and be refused. Unpublish the video's lesson (hide it) and check the preview disappears.

**Acceptance Scenarios**:

1. **Given** a published course whose instructor chose a ready video as its preview, **When** a visitor opens the landing page, **Then** the header shows the video in place of the course image and anyone can play it, with its captions and the usual player controls.
2. **Given** no preview chosen, or the chosen video is not ready, hidden, archived or deleted, **Then** the header shows the course image and no player.
3. **Given** any video of the course other than its current preview, **When** someone not enrolled asks to play it, **Then** it is refused exactly as today.
4. **Given** the instructor changes or clears the preview, **Then** the landing page follows, and the old video is no longer playable without enrolling.
5. **Given** a user who is not an instructor of the course, **When** they try to set its preview, **Then** it is refused.

---

### User Story 3 - Instructor writes the landing page (Priority: P1)

An instructor of a course edits its outcomes, requirements and preview video in the instructor portal, at any time, including after publishing, and the published page reflects the change.

**Why this priority**: Without a way to enter them, US1 and US2 have nothing to show.

**Independent Test**: As an instructor, add, reorder and remove outcomes and requirements, and choose a preview, on a draft course; publish and check the landing page. Edit again after publishing and check the page updates. Try invalid input and be refused.

**Acceptance Scenarios**:

1. **Given** an instructor of a course, **When** they save outcomes and requirements, **Then** they are stored in the order given and shown back.
2. **Given** invalid input (an eleventh outcome or requirement, a blank item, an item over 160 characters, a preview that is not a video of this course), **When** they save, **Then** it is refused with a clear message and nothing changes.
3. **Given** a published course, **When** its instructor changes the landing page fields, **Then** the landing page shows the change on the next visit, and link previews and search engines get the change within 5 minutes.
4. **Given** a user who is not an instructor of the course, **When** they try to change these fields, **Then** it is refused.
5. **Given** a course missing outcomes, requirements, a preview, an image, or an instructor profile, **When** its instructor views it, **Then** a landing page checklist shows what is missing, and publishing is still allowed.

---

### User Story 4 - Find a course through a search engine or a shared link (Priority: P2)

A person searches the web or receives a link to a course or instructor. The search engine has indexed the page's real content, and a link pasted into a chat, social network or email shows a card with the title, a short description and the image.

**Why this priority**: This is the issue's reason for being (organic traffic), but it only pays off once US1 to US3 give the page something to show.

**Independent Test**: Fetch a published course's page and an instructor's profile as a client that does not run scripts, and check the response already contains the title, description, outcomes, outline, instructor names, rating, canonical address, social card tags and structured course data. Fetch a draft course's address the same way and get a "not found" response with none of its content.

**Acceptance Scenarios**:

1. **Given** a published course, **When** a crawler or link-preview service fetches its page, **Then** the response, without running scripts, contains its title, description, outcomes, requirements, curriculum outline, instructor names, rating summary, a canonical address, social card tags (title, description, image, address) and machine-readable course data that search engines understand.
2. **Given** an instructor with a public profile, **When** a crawler fetches it, **Then** the response contains their name, headline, bio, photo and course list, with social card tags.
3. **Given** a draft, archived or unknown course, or an instructor without a public profile, **When** a crawler fetches its address, **Then** it gets a "not found" response, marked not to be indexed, with no content of the course or person.
4. **Given** a course is archived or a profile stops being public, **Then** within 5 minutes its address returns "not found" to everyone not enrolled, and it leaves the site map.
5. **Given** the site, **Then** it publishes a site map listing every published course page, every public instructor profile and every active category page, and a robots file that points to it and keeps signed-in-only areas (learning, my learning, certificates other than shared ones, sign-in) out of the index.
6. **Given** a person then opens the page in a browser, **Then** they get the same full interactive page as today, including the enrol action and their signed-in state.
7. **Given** a stage other than one configured for indexing (by default every stage except production, and local dev), **When** anything fetches any page or the robots file, **Then** every page carries a do-not-index marker and the robots file disallows everything.

---

### User Story 5 - Instructor public profile (Priority: P2)

An instructor fills in a public profile in the instructor portal: display name, headline, bio and photo. Their profile page shows these and the published courses they teach, with each course's rating. Every instructor card on a landing page links to it.

**Why this priority**: The issue asks for it and it builds trust, but landing pages stand without it (the card falls back to the instructor's name).

**Independent Test**: As an instructor teaching one published course, fill in the profile with a cropped photo and check the profile page and the instructor card on the course page. Archive the course and check the profile page returns "not found".

**Acceptance Scenarios**:

1. **Given** an instructor, **When** they save a display name (required, at most 60 characters), headline (at most 100), bio (at most 2,000, plain text with paragraphs) and photo (square, cropped in the portal), **Then** they are stored and shown back.
2. **Given** an instructor who teaches at least one published course, **When** anyone opens their profile address, **Then** it shows the profile and their published courses (newest first, with image, title and rating), and nothing of their draft or archived courses.
3. **Given** an instructor teaching no published course, **When** anyone opens their profile address, **Then** they get "not found", whatever the profile contains.
4. **Given** an instructor who never filled in a profile, **Then** their card and profile show their name as on their account (given name and family name) and a placeholder image.
5. **Given** a profile, **Then** it never shows the instructor's email, account identifier or any course they do not teach, and its address uses a public handle, not the account identifier.
6. **Given** a user who is not that instructor, **When** they try to change the profile, **Then** it is refused.

---

### Edge Cases

- A course with several instructors: one card per instructor, in the order they were added to the course; each links to that instructor's profile. No instructor can hide from a published course's page.
- An enrolled student of an archived course opens its landing address: "course not found", as for everyone; My Learning and the course home still take them into it.
- The preview video's lesson or module is hidden, or the video item is archived or deleted: the preview is treated as unset for everyone at once (it is not served from a stale address), and the instructor portal shows that the preview needs choosing again.
- The preview video is still transcoding: it is not shown until it is ready.
- A video is the preview and someone already holds its playback address: the address lasts no longer than today's enrolled playback addresses, and a new one is refused once the video stops being the preview.
- An instructor changes their handle: the profile moves to the new address at once and the old address returns "not found" (Discava has not launched; see Assumptions). Handles are unique: a taken handle is refused with a clear message, including when two instructors claim it at the same moment.
- Text with markup or links in outcomes, requirements, headline or bio is shown as plain text, never as markup, in the page and in the crawler response.
- A course image or instructor photo is missing: the social card uses the site's default image.
- A course's title, description, rating or outline changes: crawlers and link previews see the change within 5 minutes; visitors in a browser see it on the next load.
- An archived course: enrolled students keep their access through the learning pages as today; only the public landing page and profile listing stop showing it.
- A very long curriculum: the crawler response includes every visible module and lesson title.
- A visitor opens a landing page address that has a trailing slash, different letter case in the handle, or extra query parameters: they get the page, and its canonical address is the single normal form.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A course MUST be able to hold up to 10 learning outcomes and up to 10 requirements, each plain text of 1 to 160 characters after trimming, in an instructor-chosen order. Both are optional and not needed to publish.
- **FR-002**: A course MUST be able to name one of its own video content items as its preview. Only an instructor of the course may set, change or clear it, at any time, and only to a video item of that course.
- **FR-003**: Anyone, signed in or not, MUST be able to play a course's preview video, with its captions, if and only if the course is published, the item is still the course's preview, the item is ready, and the item, its lesson and its module are all visible. No other video, file or content of the course MUST become reachable without enrolment.
- **FR-004**: The course landing page MUST show, for a published course: title, image or preview video, description, outcomes, requirements, key facts (level, language and estimated hours where set, and module and lesson counts), the curriculum outline of visible modules and lessons, the rating summary and reviews, one instructor card per instructor (photo, display name, headline, link to profile), and the enrol action. Empty optional sections MUST be left out.
- **FR-005**: For a draft, archived or unknown course, the public landing page and every public response for it (crawler page, social card, site map, preview video) MUST behave as for a course that does not exist, for every caller including enrolled students. Enrolled students' existing access to archived courses through My Learning and the course home MUST NOT change.
- **FR-006**: An instructor MUST be able to keep a public profile: display name (1 to 60 characters, defaulting to their account name), headline (up to 100), bio (up to 2,000, plain text with paragraph breaks), photo (an image cropped square in the portal) and a public handle. The handle MUST be unique across instructors, 3 to 30 characters of lower-case letters, digits and single hyphens, generated from the name when first needed and changeable by the instructor; uniqueness MUST hold under concurrent claims.
- **FR-007**: An instructor's profile page MUST be public if and only if they teach at least one published course, and MUST list exactly their published courses with image, title and rating. It MUST NOT expose email addresses, account identifiers, or draft or archived courses.
- **FR-008**: When a crawler, link-preview service or any client that does not run scripts requests a public course page or instructor profile, the response MUST already contain the page's content (as listed in FR-004 and FR-007, except the reviews beyond the rating summary, which MAY be limited to the first page), a title, a meta description, a canonical address, social card tags (title, description, image, address, type) and machine-readable course data (course name, description, provider, instructors, rating) in a format the major search engines read.
- **FR-009**: The content served to crawlers MUST reflect a course or profile change, and stop serving an archived course or a no-longer-public profile, within 5 minutes. A draft course's content MUST never be served to crawlers.
- **FR-010**: Not-found public addresses MUST answer with a not-found status and a do-not-index marker, never a success status with an empty page.
- **FR-011**: The site MUST publish a site map of every published course page, public instructor profile and active category page, kept within 5 minutes of changes, and a robots file that references it and excludes signed-in-only areas from indexing.
- **FR-011a**: Indexing MUST be a per-stage setting that defaults to off and is on only for `discava-production`. On a stage with indexing off, every page MUST carry a do-not-index marker and the robots file MUST disallow everything; crawler content and social cards are still served there so they can be tested.
- **FR-012**: In a browser, the landing page and profile MUST behave as one interactive page with the rest of the student portal (signed-in state, enrol action, reviews paging), with no visible flash from the crawler content to the interactive page.
- **FR-013**: Outcomes, requirements, display name, headline and bio MUST be shown as plain text everywhere, including in crawler responses and social card tags.
- **FR-014**: The instructor portal MUST let an instructor edit a course's outcomes, requirements and preview on the course's settings, and edit their own profile on a profile page, with a link to view the public page. It MUST show a landing page checklist (outcomes, requirements, preview, image, instructor profile) for each course, which never blocks publishing.
- **FR-015**: Every endpoint this feature adds that anonymous callers can reach MUST be protected by the same per-stage security controls (including per-client rate limiting) as the existing public course procedures. An anonymous playback address MUST cover only the preview item's own renditions and caption tracks, MUST last no longer than an enrolled student's playback address, and MUST be issued only while the item is the course's preview (FR-003).
- **FR-015a**: Every instructor of a published course MUST appear on its landing page; there is no opt-out.
- **FR-016**: The feature MUST work end to end in local development without an AWS account, including preview playback, profile photos and fetching the crawler response of a course and a profile.
- **FR-017**: The feature MUST NOT add course address slugs, instructor follower counts, messaging instructors, multiple preview videos, free preview lessons beyond the one video, promotional pricing or paid-course display (see Assumptions).

### Key Entities

- **Course** (existing): gains its learning outcomes, requirements and preview video choice.
- **Instructor profile**: One per instructor who has one. Display name, headline, bio, photo, public handle, and when it was last changed.
- **Handle claim**: Reserves a public handle for one instructor, so two instructors can never hold the same handle.
- **Course instructor** (existing): decides which instructors' cards a course shows and which courses a profile lists.
- **Content item** (existing): the video chosen as the preview; its readiness and visibility decide whether the preview shows.
- **Rating summary**, **Category** (existing): read for the landing page, profile course list and site map.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of published course pages and public profiles, fetched without running scripts, contain the page's title, description, outline (for courses), social card tags and structured data; validated by an automated check on every build.
- **SC-002**: 0 responses, in tests and the data-consistency check, that expose a draft course, an archived course on a public address, a non-preview video to someone not enrolled, or an email or account identifier on a public page.
- **SC-003**: Changes to a course or profile reach crawler responses and the site map within 5 minutes in 95% of cases, and an archived course leaves them within 5 minutes in 100% of cases.
- **SC-004**: A visitor on an ordinary connection sees the landing page's title and header within 2 seconds of opening a shared link.
- **SC-005**: An instructor can fill in a course's outcomes, requirements and preview, and their own profile, in under 5 minutes in total.
- **SC-006**: Link previews of a course in common messaging and social apps show its title, description and image (checked by hand before merge for at least two apps).
- **SC-007**: 0 pages on a non-indexing stage served without a do-not-index marker.

## Assumptions

- The existing public course page at `/learn/<courseId>` becomes the landing page; addresses keep the course identifier. Readable course address slugs are a follow-up, since every learning route uses the identifier.
- Instructor profiles live at a new public address using the handle (for example `/instructors/<handle>`). Handles may change freely before launch; old addresses are not redirected (constitution VII).
- The preview is one of the course's existing video content items, not a separate upload, so it reuses the transcoding, captions and playback already built (#277). A dedicated promo upload and multiple free preview lessons are follow-ups.
- Instructor names are public: they appear on landing pages and profiles. Students' names stay as the reviews feature shows them (#279) and are not affected.
- Outcomes and requirements are plain text lists, not rich text, matching the plain-text course description.
- Category pages (#283) are already public; this feature adds them to the site map and gives them social card tags, but does not change them otherwise.
- Paid courses (#284, spec in review) will add a price to the landing page and crawler data when they land; this feature leaves a place for it but shows none.
- 5 minutes is acceptable staleness for search engines and link previews; people in a browser always see live data.
- Out of scope: course address slugs, a separate promo video upload, free preview lessons, "who this course is for", instructor statistics (total students, total reviews), following or messaging instructors, localised landing pages (#292), and paid-course display (#284).
- Discava has not launched: no old data or addresses to preserve, so attributes, entities and routes are added outright.
- Only the final implementation PR may close #287.
