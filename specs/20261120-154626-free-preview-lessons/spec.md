# Feature Specification: Free Preview Lessons

**Feature Branch**: `20261120-154626-free-preview-lessons` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Issue #595: free preview lessons. Instructors mark individual lessons as free preview (assignment lessons can't be). The public course page and outline label them and let anyone, signed out included, open them without enrolling or buying. A preview shows the lesson's video, text and file items with the normal player; quizzes are shown but need enrolment; nothing is recorded as progress. Media access opens for a preview lesson only. The page renderer includes preview lessons in the course's public HTML where useful. Acceptance: a signed-out visitor can watch a preview lesson of a published course and cannot open any other lesson's media; hidden, archived or draft content is never exposed; the paid-content access invariant holds with previews as its one stated exception; unmarking removes public access at once."

**Parent issue**: #595

**Design page**: [`design/public-pages`](../../docs/src/content/docs/en/design/public-pages.mdx) (gains a "Free preview lessons" section)

## User Scenarios & Testing *(mandatory)*

Today a visitor decides whether to enrol in, or pay for, a course from its landing page: a description, an outline of titles, reviews and an optional promo video. Nothing of the course itself can be opened without an enrolment, and for a priced course an enrolment needs a paid order (Stripe checkout spec, User Story 2). This feature lets an instructor open chosen lessons to everyone. It is a deliberate exception to "unpaid users cannot get paid content", so most of this spec is about how narrow that exception is.

Three words are used throughout:

- A lesson is **marked** when an instructor has chosen it as a free preview.
- A marked lesson is an **open preview** only while all of these hold: its course is published, its module and the lesson itself are visible and not archived, and it is an ordinary lesson (not an assignment lesson). A marked lesson that is hidden, archived, or in a draft or archived course is not open.
- A **visitor** is anyone without a current enrolment in the course: signed out, signed in but not enrolled, or a student whose enrolment has ended (refunded or left).

### User Story 1 - Watch a preview lesson without enrolling (Priority: P1)

A visitor opens a course's landing page. In the outline, some lessons carry a "Free preview" label and are links. The visitor opens one and sees the lesson as an enrolled student would: its videos play in the normal player with captions and speed control, its text can be read and its files downloaded. No sign-in is asked for.

**Why this priority**: This is the feature. A visitor who can watch a real lesson can judge the teaching before paying.

**Independent Test**: As an instructor, publish a priced course with one marked lesson holding a video, a text and a file. Signed out, open the landing page, follow the "Free preview" link, play the video with captions, read the text and download the file.

**Acceptance Scenarios**:

1. **Given** a published course with an open preview lesson, **When** anyone views the landing page, **Then** that lesson shows a "Free preview" label in the outline and is a link, and the other lessons look as they do today.
2. **Given** an open preview lesson with a ready video, **When** a signed-out visitor opens it and presses play, **Then** the video plays in the normal player, with its caption tracks and playback speed available.
3. **Given** an open preview lesson with a text item and a file item, **When** a visitor opens it, **Then** the text is shown in full and the file downloads under its own name.
4. **Given** an open preview lesson with a quiz item, **When** a visitor opens it, **Then** the quiz is shown as a card with its title and number of questions and the words "Enrol to take this quiz"; its questions and answers are not shown and it cannot be attempted.
5. **Given** a visitor who is signed in but not enrolled, or whose enrolment has ended, **When** they open an open preview lesson, **Then** they see exactly what a signed-out visitor sees.
6. **Given** an open preview lesson whose video is still being processed, **When** a visitor opens it, **Then** the lesson's other items are shown and the video says it is being prepared.
7. **Given** a free course with an open preview lesson, **When** a signed-out visitor opens it, **Then** it works the same way: a preview does not depend on the course having a price.

---

### User Story 2 - A preview opens nothing else (Priority: P1)

Marking a lesson opens that lesson's visible items and nothing more. Every other lesson, every hidden or archived item, and every draft or archived course stay exactly as closed as they are today, to a visitor who goes looking as much as to one who does not.

**Why this priority**: The money-protecting rule. A preview that can be stretched to reach a second lesson gives a paid course away.

**Independent Test**: With a priced course that has one open preview lesson and one ordinary lesson, try as a signed-out caller and as a signed-in, not enrolled student to reach the ordinary lesson's video, file and text by every route, including asking the preview route for the other lesson's items. All are refused, and the data-consistency check passes after each attempt.

**Acceptance Scenarios**:

1. **Given** a lesson that is not marked, **When** a visitor asks for it, or for any of its items or media, through the preview route, **Then** it is refused as not available and nothing about it is returned.
2. **Given** an open preview lesson and an item that belongs to a different lesson, **When** a visitor asks the preview route for that item under the preview lesson's address, **Then** it is refused as not available.
3. **Given** a marked lesson that is hidden or archived, or whose module is hidden or archived, **When** a visitor asks for it, **Then** it is refused as not available, in the same words as for a lesson that does not exist.
4. **Given** a marked lesson in a draft or archived course, **When** a visitor asks for it, **Then** it is refused as not available, in the same words as for a course that does not exist.
5. **Given** an open preview lesson with a hidden or archived item, **When** a visitor opens the lesson, **Then** that item is not listed and its video or file cannot be requested.
6. **Given** a visitor holding a playback permission for a preview video, **When** they use it to request any other video's files, **Then** the request is refused.
7. **Given** a signed-in student who is not enrolled in a priced course, **When** they call any of the ways an enrolled student reads a course (the course's content, a video address, a file link, a quiz, completions, a saved video position, an assignment, a discussion), naming an open preview lesson or one of its items, **Then** each is refused exactly as it is today for any lesson.
8. **Given** a preview lesson's response, **When** it is inspected, **Then** it contains no storage location, no quiz question or answer, no assignment instructions, and nothing about any other lesson's items.

---

### User Story 3 - Instructor marks lessons as free preview (Priority: P1)

An instructor of a course switches "Free preview" on for an ordinary lesson in the course editor, after confirming that anyone will be able to open it. The lesson shows a "Free preview" badge. Switching it off closes it to visitors at once.

**Why this priority**: Nothing can be previewed until a lesson is marked. It is a small slice, but the first one the code needs.

**Independent Test**: As an instructor, mark a lesson in a draft course and in a published course, see the badge, unmark it, and see that an assignment lesson offers no such control. As a non-instructor, try and fail.

**Acceptance Scenarios**:

1. **Given** an instructor of a course and an ordinary lesson, **When** they switch Free preview on and confirm, **Then** the lesson is marked and shows a "Free preview" badge in the editor.
2. **Given** an assignment lesson, **When** the instructor looks at it, **Then** no Free preview control is offered, and a request to mark it sent anyway is refused with a message that assignment lessons can't be free previews.
3. **Given** a marked lesson, **When** the instructor switches Free preview off, **Then** from that moment a visitor asking for the lesson, its items or its media is refused as not available.
4. **Given** a marked lesson that is hidden, or in a draft course, **When** the instructor views it, **Then** the badge says it is not public yet, and it becomes an open preview by itself when the lesson is visible in a published course.
5. **Given** a user who is not an instructor of the course, **When** they try to mark or unmark a lesson, **Then** it is refused.
6. **Given** an archived lesson, or a lesson in an archived course, **When** the instructor tries to mark or unmark it, **Then** it is refused as other edits to it are.
7. **Given** a marked lesson, **When** the instructor hides it, archives it, restores it or moves it, **Then** the mark stays on the lesson and only the lesson's visibility decides whether it is open.

---

### User Story 4 - From a preview to enrolling (Priority: P2)

A preview is for looking. It records nothing about the visitor, and the page offers the next step: enrol in a free course, or buy a priced one. After enrolling, the student is in the same lesson in the normal player, where progress starts to count.

**Why this priority**: Without it a preview is a dead end, and a preview that silently recorded progress for someone who never enrolled would break the rules that tie student records to enrolments. The preview is still watchable without it.

**Independent Test**: Signed out, watch a preview video to the end, then check that no record of any kind exists for the visit. Sign in, enrol (or buy, for a priced course) from the preview page, and land on the same lesson in the normal player with no progress yet.

**Acceptance Scenarios**:

1. **Given** a visitor watching a preview, **When** they play, pause, finish the video, read the text or download the file, **Then** no completion, progress, saved video position, quiz attempt, activity count or enrolment is recorded.
2. **Given** a visitor on a preview page, **When** they look at it, **Then** it offers the same action the course's landing page offers them (Enrol now for a free course, Buy now with the price for a priced one, or the sign-in form of either), and says that progress is saved once they enrol.
3. **Given** a visitor on a preview page of a priced course, **When** they choose Buy now and pay, **Then** they return enrolled and are taken to that lesson in the normal player.
4. **Given** a student with a current enrolment, **When** they open a preview address, **Then** they are taken to that lesson in the normal player, where their progress is recorded as usual.
5. **Given** a preview page, **When** a visitor looks for the lesson's discussion, **Then** none is shown and nothing can be posted.
6. **Given** a course with several open preview lessons, **When** a visitor is on one, **Then** the page lists the others so they can move between them, and links back to the landing page.
7. **Given** a preview address whose lesson is no longer an open preview, **When** anyone opens it, **Then** the page says the preview is no longer available and links to the course's landing page if the course is still published.

---

### User Story 5 - Search engines and shared links see which lessons are free (Priority: P3)

The landing page's content served to crawlers marks the open preview lessons in the outline, so a search result or a shared link can say the course has free lessons. The preview lesson's own content is not served to crawlers and is not indexed.

**Why this priority**: Useful for discovery, but the preview works for people without it.

**Independent Test**: Fetch a published course's landing page as a client that runs no scripts and find the "Free preview" label beside the marked lesson's title; fetch the preview lesson's address the same way and find no lesson content and a do-not-index marker.

**Acceptance Scenarios**:

1. **Given** a published course with an open preview lesson, **When** a crawler fetches the landing page, **Then** the outline in the response labels that lesson "Free preview" and links to its preview address.
2. **Given** a lesson that is unmarked, **When** a crawler fetches the landing page more than 5 minutes later, **Then** the label is gone.
3. **Given** a preview lesson's address, **When** a crawler fetches it, **Then** the response holds none of the lesson's text or media, carries a do-not-index marker, and the site map does not list the address.

---

### Edge Cases

- An instructor unmarks a lesson while a visitor is watching it: the visitor's current video keeps playing for at most an hour (the life of the playback permission already issued), no new permission is issued, and reloading shows that the preview is no longer available. Text already on the screen and a file already downloaded cannot be taken back.
- An instructor hides or archives a marked lesson, or its module, or archives or unpublishes the course: the same as unmarking, by the same rule, with the mark left in place.
- An instructor adds an item to a marked lesson in a published course: it starts hidden, as new items do today, and joins the preview when the instructor publishes it.
- An instructor replaces a marked lesson's video: visitors keep playing the previous version until the new one is ready, as enrolled students do.
- An instructor marks every lesson of a priced course: allowed. The course's quizzes, assignments, discussions, progress and certificate still need an enrolment, and the confirmation in the editor says what marking does.
- A course's price changes, or it is set to free or priced again: marks are unaffected.
- A visitor opens a preview address for a lesson that was never marked, by guessing: refused as not available, identically to a lesson that does not exist.
- A visitor asks for a preview video with a valid lesson address but names a video item from a non-preview lesson of the same course: refused as not available.
- A preview lesson with no visible items: the page shows the lesson's title and description and says there is nothing to show yet.
- A marked lesson whose only item is a quiz: the page shows the locked quiz card and the enrol action.
- A video in a preview lesson carries in-video questions (#591, specified separately): in a preview the video plays through without asking them, by the same rule as quizzes.
- A visitor's playback permission runs out during a long video while the page is still open: the page renews it in the background and playback continues; a page left closed for over an hour asks again when reopened.
- A student who was refunded, or who left the course, opens a preview: they are a visitor and see the preview like anyone else.
- A student enrolled in an archived course opens a preview address of it: they have an enrolment, so they are taken to the lesson in the normal player as today; visitors get "no longer available".
- A flood of anonymous requests for preview content: held back by the same request limits and web firewall as the other public course requests; beyond the limit, callers are told to try again and nothing else is affected.
- Another website embeds a preview video's address: it does not play there, because the playback permission is tied to this site.
- The landing page shown to a visitor is up to 5 minutes old and still labels a lesson that was just unmarked: the link leads to "no longer available"; no content is served from the stale page.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An instructor of a course MUST be able to mark and unmark an ordinary lesson of that course as a free preview. The mark belongs to the lesson, not to its items. Marking MUST be refused for an assignment lesson, for an archived lesson, in an archived course, and for anyone who is not an instructor of the course. A new lesson is not marked. There is no limit on how many lessons of a course are marked, and marking does not depend on the course's price.
- **FR-002**: A marked lesson MUST be an open preview if and only if its course is published, its module and the lesson are visible and not archived, and it is an ordinary lesson. This one definition MUST decide every preview response; no other state of the lesson, the course or the caller changes it.
- **FR-003**: Anyone, signed in or not, MUST be able to open an open preview lesson and get: the lesson's title and description, and each of its visible, unarchived items. A video item plays in the same player enrolled students use, with its caption tracks and speed control. A text item is shown in full. A file item can be downloaded. A quiz item is shown as a locked card with its title and number of questions only. An item of any other kind is not listed.
- **FR-004**: The preview MUST give the same response to every caller. It MUST NOT read or depend on who is asking.
- **FR-005**: A playback permission issued for a preview video MUST cover only that video's played version (its stream files and caption tracks), MUST last no more than one hour, and MUST be requested only when the visitor presses play. The page MUST renew it while it stays open. A download link issued for a preview file MUST cover that one file and MUST last no longer than an enrolled student's (five minutes).
- **FR-006**: The preview MUST be the only way to read any course content without a current enrolment. Every existing way an enrolled student reads or acts on a course (course content, video address, saved video position, file link, quiz view and attempt, completions, lesson progress, assignments, discussions, announcements) MUST keep refusing a caller without a current enrolment, for marked lessons as for any other.
- **FR-007**: A preview request for anything that is not an open preview lesson, or not a visible item of the open preview lesson it names, MUST be refused as not available, with the same response whether the target is unmarked, hidden, archived, in a draft or archived course, of the wrong kind, or does not exist.
- **FR-008**: A preview response MUST NOT contain: a hidden or archived item; a quiz's questions, answer key or settings; assignment instructions; any storage location of a video, caption track or file; or anything about another lesson's items.
- **FR-009**: Viewing a preview MUST NOT create or change any record: no enrolment, completion, lesson or course progress, saved video position, quiz attempt, activity count or discussion post. The preview page MUST NOT show the lesson's discussion.
- **FR-010**: From the moment a lesson stops being an open preview (it is unmarked, hidden or archived, its module is hidden or archived, or its course is archived), every preview request for it MUST be refused, with no delay and no cached answer. Permissions already issued end by their own life (one hour for a video, five minutes for a file) and are not revoked. Addresses already handed out MUST show a "preview no longer available" page, not a sign-in form and not a redirect.
- **FR-011**: The public course landing page MUST label each open preview lesson "Free preview" in its outline and link it to the lesson's preview address. Lessons that are not open previews MUST look as they do today.
- **FR-012**: The preview page MUST show the course's title with a link to its landing page, the lesson, a list of the course's other open preview lessons, and the same enrol or buy action, with the same rules, that the landing page offers that visitor. It MUST say that progress is saved once they enrol.
- **FR-013**: A student with a current enrolment who opens a preview address MUST be taken to that lesson in the normal player. A visitor who enrols or buys from a preview page MUST land on that lesson in the normal player once enrolled.
- **FR-014**: The instructor portal MUST offer a Free preview control on each ordinary lesson, with a confirmation before marking that says anyone will be able to open the lesson without enrolling or paying. It MUST show a "Free preview" badge on marked lessons, and on a marked lesson that is not open (hidden, or in a draft course) MUST say it is not public yet. Assignment lessons MUST NOT offer the control.
- **FR-015**: The landing page content served to crawlers MUST include the "Free preview" label and link for open preview lessons, and MUST reflect a change within 5 minutes, as the rest of that content does. A preview lesson's own address MUST NOT serve lesson content to crawlers, MUST carry a do-not-index marker, and MUST NOT be listed in the site map.
- **FR-016**: Every endpoint this feature adds that anonymous callers can reach MUST be protected by the same per-stage controls as the existing public course endpoints: the web firewall where the stage enables it and the public request limits. A preview video MUST NOT play when embedded in another website.
- **FR-017**: The rule "unpaid users cannot get paid content" MUST be restated with open preview lessons as its one named exception, in the rule's description and in its tests: the data-consistency rule that an enrolment in a priced course rests on a paid order MUST stay unchanged (a preview creates no enrolment); tests MUST show that each existing content route still refuses a caller without an enrolment for a marked lesson, and that the preview route cannot reach an unmarked, hidden, archived or draft target or another lesson's media. A data-consistency check that a test can break MUST state that only ordinary lessons are marked.
- **FR-018**: The feature MUST work end to end in local development without an AWS account, including marking a lesson, opening it signed out, playing its video and downloading its file.
- **FR-019**: The feature MUST NOT add: marking single items, a limit or quota of previews, time-limited or first-minutes-only previews, a count or report of preview views, collecting a visitor's email, previews of assignment lessons, quiz attempts or in-video question answers by visitors, public discussions, indexing of a preview lesson's content by search engines, or an offline download of videos.

### Key Entities

- **Lesson**: Existing. Gains the free preview mark, set and cleared by the course's instructors. Only an ordinary lesson can carry it.
- **Open preview**: Not stored. The state of a marked lesson that is visible in a visible module of a published course; computed by one rule at the moment of each request.
- **Preview lesson view**: What a visitor receives for an open preview: the lesson's title and description and its visible items, each reduced to what a visitor may see (FR-003, FR-008).
- **Playback permission and download link**: Existing mechanisms for enrolled students. For a preview they are issued without an enrolment, scoped to one video version or one file, and short-lived (FR-005).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-out visitor can go from a course's landing page to a playing preview video in two actions (open the lesson, press play), with no sign-in, and the video starts within 5 seconds on a normal connection.
- **SC-002**: 0 cases where a caller without a current enrolment obtains content or media of a lesson that is not an open preview, through the preview route or any other, in every test of User Story 2.
- **SC-003**: 0 cases where a hidden or archived module, lesson or item, or anything of a draft or archived course, appears in a preview response.
- **SC-004**: After a lesson stops being an open preview, 100% of preview requests for it are refused from the next request on, and no playback permission issued before the change works for longer than one hour after it.
- **SC-005**: 0 records of any kind are created or changed by viewing previews, and the data-consistency check passes after every test.
- **SC-006**: An instructor can mark or unmark a lesson in under 30 seconds, and the landing page shows the change to visitors within 5 minutes.
- **SC-007**: A visitor on a preview page can start enrolling or buying in one action, and after enrolling is on the same lesson in the normal player without searching for it.
- **SC-008**: 100% of crawler responses for a preview lesson's address contain no lesson content and carry a do-not-index marker.

## Assumptions

- **The preview is its own route, not a wider door on the existing ones.** The existing ways to read a course stay exactly as closed as they are; the exception is a small, separately named set of public requests. This is why the paid-content rule's existing tests stay untouched and are added to, not loosened.
- **A preview is public content by the instructor's choice.** Anyone can open it, so anyone determined can copy it, as they can copy a promo video today. The feature limits what is opened, not what a visitor does with it.
- **"At once" means no new access.** Unmarking stops every new response immediately. A video permission already issued lasts up to an hour and a file link up to five minutes; neither is revoked, because revoking would mean moving the files. One hour, not the four an enrolled student gets, keeps that tail short.
- **Quizzes are shown locked, without their questions.** The issue asks that quizzes "are shown but need enrolment to attempt". Showing the questions to everyone would publish assessment content for nothing a visitor can do with it, so the card shows the title and the number of questions only. In-video questions (#591, specified in parallel) follow the same rule: not asked in a preview.
- **Previews work on free courses too.** There a visitor could enrol for nothing, but watching without an account is still the lighter step, and tying the mark to the price would add a rule to every price change.
- **No preview analytics.** Because nothing is recorded, instructors get no count of preview views. A count would need a record written by anonymous traffic, which is a follow-up with its own abuse questions.
- **Search engines index the landing page, not the lesson.** The label helps discovery; the lesson's content stays out of search engines so that unmarking is not undone by a search engine's stored copy.
- **Depends on the Stripe checkout spec (#284), Phases 1 to 7**, all merged on `main` when this spec was written: prices, the refusal of unpaid enrolment, the purchase and the landing page's Buy now. This feature reuses that page's enrol and buy actions unchanged. Checkout's later phases (expiry, refunds, leaving a course) do not block it; a refunded or departed student is simply a visitor.
- **Depends on the public course pages spec (#287)**, merged on `main`: the landing page, its outline, the crawler content and the promo video, whose anonymous playback is the precedent for this feature's.
- **The course-level promo video is unchanged.** It stays a separate upload; a preview lesson is real course content.
- Discava has not launched: the mark is added outright, with no migration, and existing lessons are simply not marked.
- Only the final implementation PR may close #595.
