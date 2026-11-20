# Feature Specification: Transcript Panel and Transcript Search

**Feature Branch**: `20261120-002950-transcript-search` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Transcript panel and transcript search (GitHub issue #590). Learners get a readable transcript panel beside the lesson video player, built from the active caption track: the current cue is highlighted and scrolls into view, clicking a cue seeks the video, and the panel follows the selected caption language. Learners can search within a course's transcripts from the course player: results show the lesson, the matching text and its timestamp, and open the lesson at that moment. Caption text is indexed in OpenSearch and kept in sync when captions are generated, uploaded, replaced or deleted and when a lesson or item is hidden, archived or deleted. Transcript text and search results are limited to what the learner may watch (enrolled, item shown), the same checks as contentItem.videoUrl. Keyboard and screen-reader accessible; works at phone width (panel below the player). The index must be usable later by the AI tutor (#289) for passage retrieval; the tutor and machine-translated captions (#593) are out of scope."

**Parent issue**: #590

**Design pages**: [`design/video-player`](../../docs/src/content/docs/en/design/video-player.mdx) (gains a "Transcript" section) and [`design/search`](../../docs/src/content/docs/en/design/search.mdx) (gains a "Transcript search" section)

## Clarifications

### Session 2026-11-20

Resolved without asking, using the recommended defaults (non-interactive run). The owner should confirm each one; the pull request lists them.

- Q: A video can have up to 10 caption tracks. Which one does search look in? → A: One track per video: the language the learner has chosen for captions when the video has a track in it, otherwise the video's default track. Every track is kept searchable, so switching language changes what is searched without any re-processing.
- Q: What does choosing a transcript line do to playback? → A: The video jumps to the start of that line and plays, whether it was playing or paused.
- Q: Is the transcript panel open when a lesson loads? → A: No. A "Transcript" button on the player opens it, and the choice is remembered in the browser with the other player preferences (speed, volume, captions).
- Q: Does search run as the learner types, and how many results does it show? → A: It runs when the learner submits (Enter or the Search button) with at least 2 characters, and shows up to 20 moments, best match first, with no paging. A learner who needs more narrows the search.
- Q: What does opening a result do? → A: The lesson opens scrolled to that video, already moved to the moment and paused, with a short "Starting at m:ss" notice. The learner presses play. It doesn't start with sound on its own, and the learner's saved resume position is left as it was until they play.

## User Scenarios & Testing *(mandatory)*

Every transcoded lesson video already gets captions: one generated automatically, and any the instructor uploads, up to 10 tracks per video, one per language. Today a learner can only see them as an overlay on the video. This feature lets a learner read them as a transcript beside the video, and search what was said across a whole course.

Only the student portal's lesson player changes. The instructor's preview player and the public course preview video keep working as they do today, without a transcript.

### User Story 1 - Read a video's transcript and jump to any line (Priority: P1)

A learner watching a lesson video opens the transcript. It lists everything said in the video, line by line, each with its time. As the video plays, the line being spoken is highlighted and kept in view. Choosing any line moves the video to that moment and plays from there. The transcript is in the language the learner chose for captions, and changes when they choose another.

**Why this priority**: This is the core of the feature and needs nothing new stored or processed: the caption files are already there. It gives a text alternative to learners who read faster than they listen or who can't use the audio, and lets anyone review a video without rewatching it.

**Independent Test**: Open a lesson whose video has captions, open the transcript, and check that every caption line is listed, that the highlighted line follows playback, and that choosing a line moves the video to that line's time.

**Acceptance Scenarios**:

1. **Given** a video with at least one caption track, **When** the learner chooses "Transcript", **Then** a panel lists every line of the track in order, each with its start time.
2. **Given** the panel is open and the video is playing, **When** playback reaches a line, **Then** that line is highlighted and scrolled into view inside the panel, without the page itself scrolling.
3. **Given** the panel is open, **When** the learner chooses a line, **Then** the video moves to that line's start time and plays.
4. **Given** a video with tracks in two languages, **When** the learner picks the other language in the captions menu, **Then** the transcript shows that language's lines.
5. **Given** the learner has captions turned off, **When** they open the transcript, **Then** it shows the track captions would use if turned on (their remembered language if the video has it, otherwise the default track), and the overlay stays off.
6. **Given** a video with no caption track (none generated yet, or captioning failed), **When** the lesson loads, **Then** there is no "Transcript" button.
7. **Given** the learner opened the transcript on one video, **When** they open another lesson later in the same browser, **Then** the transcript is open there too.

---

### User Story 2 - Search what was said in a course and open that moment (Priority: P1)

An enrolled learner remembers that something was explained somewhere in the course. From the course player they search for a word or phrase. The results list the moments where it was said: the lesson, the video, the time and the sentence around the match, with the matching words standing out. Choosing a result opens that lesson with the video moved to that moment.

**Why this priority**: Finding a moment without rewatching is the second half of the issue, and the searchable transcripts it creates are what the AI tutor (#289) will later retrieve from.

**Independent Test**: In a course with a captioned video in which a known phrase is spoken at a known time, search the phrase from the course player, and check that the result names the lesson and the time, and that choosing it opens the lesson with the video at that time.

**Acceptance Scenarios**:

1. **Given** an enrolled learner and a video in which "gradient descent" is said at 12:40, **When** they search "gradient descent" in the course, **Then** a result shows the lesson's title, 12:40, and the surrounding text with "gradient descent" marked.
2. **Given** that result, **When** the learner chooses it, **Then** the lesson opens scrolled to that video, the video is at 12:40 and paused, and a short notice says "Starting at 12:40".
3. **Given** a lesson with two videos, **When** a result is in the second, **Then** the result names that video and opens that one.
4. **Given** more than 20 moments match, **When** results show, **Then** the 20 best matches are listed and the page says to narrow the search to see others.
5. **Given** nothing matches, **When** results show, **Then** the page says no moments match and suggests checking the spelling or the caption language.
6. **Given** the words searched are spoken across two neighbouring caption lines, **When** the learner searches them, **Then** the moment is still found.
7. **Given** a search for "designing", **When** a video's English transcript says "design", **Then** it matches (English word forms are treated as the same word).
8. **Given** a course with no captioned video the learner may watch, **When** they search, **Then** they see the "no moments match" state, not an error.

---

### User Story 3 - Transcript text only reaches learners who may watch the video (Priority: P1)

Transcript text is course content. A person gets it, in the panel or in search results, only when they could play that video right now: they are enrolled in the course (and haven't dropped it or been refunded), and the video, its lesson and its module are all shown to students and not archived. This is decided by the service each time, never by what the browser sends.

**Why this priority**: A paid course's transcripts are the course. Leaking them through search would give the content away to anyone who can guess a course's address.

**Independent Test**: With a captioned video indexed, search its text as: a signed-out visitor, a signed-in user who isn't enrolled, a learner who dropped the course, and an enrolled learner after the instructor hid the video. None of them gets any transcript text; an enrolled learner of a shown video does.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor, **When** they ask for a course's transcript search, **Then** they are refused and get no text.
2. **Given** a signed-in user who isn't enrolled in the course, **When** they search it, **Then** they are refused, the same way playing its videos is refused.
3. **Given** a learner whose enrolment was dropped or refunded, **When** they search, **Then** they are refused.
4. **Given** an enrolled learner, **When** the instructor has hidden or archived a video, its lesson or its module, **Then** no result comes from that video, even in the first seconds after the change.
5. **Given** an enrolled learner in a course that was archived after they enrolled, **When** they search, **Then** search works, as playing the videos still does.
6. **Given** an enrolled learner, **When** they send another course's identifier or a made-up lesson or video identifier with the request, **Then** they get nothing they couldn't already watch.
7. **Given** an enrolled learner, **When** a video is being replaced by a new version that is still processing, **Then** results come from the version they can still play, never from the one they can't yet.

---

### User Story 4 - Search follows what the instructor changes (Priority: P2)

When captions are generated for a new video, or an instructor uploads, replaces or removes a caption track, replaces the video, or hides, archives, shows again or deletes a video, a lesson or a module, search follows within a short time without anyone doing anything. Text from a removed or replaced track stops being found, and text from a new one starts.

**Why this priority**: Without it search slowly fills with moments that no longer exist and misses new ones. It's P2 only because Story 3 already guarantees nothing hidden is shown in the meantime.

**Independent Test**: Upload a caption track containing a unique phrase, search it and find it; replace the track with one that has a different unique phrase; within a minute the first phrase finds nothing and the second is found.

**Acceptance Scenarios**:

1. **Given** a new video finishes processing and its automatic captions arrive, **When** a minute has passed, **Then** its speech is searchable.
2. **Given** an instructor uploads a track for a language that already has one, **When** a minute has passed, **Then** the old track's text is no longer found and the new track's is.
3. **Given** an instructor removes a track, **When** a minute has passed, **Then** its text is no longer found.
4. **Given** an instructor hides a lesson and later shows it again, **When** a minute has passed after each change, **Then** its videos' text is gone, then back.
5. **Given** an instructor deletes a video, a lesson or a module, **When** a minute has passed, **Then** nothing from it is found, and nothing about it stays stored for search.
6. **Given** an instructor replaces a video, **When** the new version is ready and has captions, **Then** search finds the new version's text and none of the old version's.
7. **Given** transcripts stored for search were lost or are out of date (the store was recreated, or a fault stopped updates), **When** an operator runs the rebuild, **Then** every watchable video's transcripts are searchable again and nothing stale remains.

---

### User Story 5 - Use the transcript and search with a keyboard, a screen reader or a phone (Priority: P2)

A learner who doesn't use a mouse reaches the transcript with Tab, moves through its lines with the arrow keys and jumps the video with Enter. A screen reader says what the panel is, reads each line with its time, and says which line is the current one, without being interrupted by every new line as the video plays. On a phone the transcript sits below the video and scrolls on its own. A learner who scrolls back to read isn't pulled away by the highlight following playback.

**Why this priority**: The transcript exists partly for learners who can't use the audio, so it must be fully usable without a mouse or sight. The first story already ships real buttons and labels. This story adds what makes a list of several hundred lines comfortable.

**Independent Test**: With the keyboard only, open the transcript, move down five lines with the arrow key, press Enter, and check the video is at that line. Repeat with a screen reader. Then at a 375-pixel-wide window check the panel is below the video and nothing scrolls sideways.

**Acceptance Scenarios**:

1. **Given** the panel is open, **When** the learner presses Tab from the player, **Then** focus enters the transcript in one step (on the current line), and one more Tab leaves it.
2. **Given** focus is on a line, **When** the learner presses Down, Up, Home or End, **Then** focus moves to the next, previous, first or last line, and the video's volume and position don't change.
3. **Given** focus is on a line, **When** the learner presses Enter or Space, **Then** the video moves to that line and plays, and focus stays on the line.
4. **Given** the video is playing, **When** the learner scrolls the transcript or moves focus within it, **Then** the panel stops following playback, and a "Jump to current line" button appears that resumes following.
5. **Given** a screen reader, **When** the learner reaches the panel, **Then** it is announced as the transcript with its language, each line is read as its time and text, and the current line is identified as current.
6. **Given** a screen reader and a playing video, **When** the highlight moves on, **Then** nothing is announced on its own.
7. **Given** a window 375 pixels wide, **When** the panel is open, **Then** it is below the video at a limited height, scrolls inside itself, and the page has no horizontal scrolling.
8. **Given** the learner asked their device for reduced motion, **When** the panel follows playback, **Then** it moves without animation.
9. **Given** the search results, **When** the learner uses only the keyboard or a screen reader, **Then** the search box has a label, the number of results is announced, and each result is one link that reads as lesson, video, time and text.

---

### Edge Cases

- **Captions still being generated**: the video plays with no "Transcript" button. Once the captions exist, the button is there the next time the lesson loads.
- **A caption file that fails to load**: the transcript shows another of the video's tracks, chosen the way the captions menu chooses. If none loaded, it says the transcript couldn't be loaded. The video keeps playing either way.
- **A caption file with styling or speaker markup**: lines show as plain text. Markup, positioning and voice tags are dropped, and nothing in a caption file is ever treated as page markup.
- **Lines that overlap in time**: the highlight is on the latest line that has started. Silence between lines keeps the last spoken line highlighted.
- **A very long video**: a two-hour lecture's transcript (a few thousand lines) opens and scrolls without the page freezing.
- **Fullscreen and picture-in-picture**: the panel isn't shown inside fullscreen. It's where the learner left it on leaving fullscreen.
- **Two videos in one lesson**: each has its own transcript, opened and followed separately.
- **A result whose moment is gone when it's opened** (the video was replaced, hidden or deleted after the search): the lesson opens as it does today for that case. A time past the end of the video is treated as its end, the way a saved position is today.
- **A link to a moment shared with someone not enrolled**: they see what a lesson link shows them today. Nothing about the transcript is revealed.
- **Search while the search service is starting up**: on a stage where search scales to zero, the first request can time out. The page says search is starting and to try again, as course search does.
- **Search text that is too short, too long or only punctuation**: under 2 characters shows a short hint and makes no request, the box takes at most 200 characters, and punctuation alone finds nothing.
- **Special characters and other scripts**: any text can be searched without an error. Languages written without spaces between words match less precisely (see Assumptions).
- **The same moment matched twice**: a moment appears once in the results, even when the words searched fall where two stored passages meet.
- **Two changes to a video's captions within a few seconds**: search settles on the final state. Text left over from the middle state is never shown (Story 3) and is cleared by the rebuild.
- **Captions-only changes to a hidden video**: nothing becomes searchable until the video is shown.
- **A course with thousands of videos**: one search still answers in about the same time, because it only looks at that course.

## Requirements *(mandatory)*

### Functional Requirements

**Transcript panel**

- **FR-001**: The student lesson player MUST offer a "Transcript" control whenever the video has at least one caption track, and MUST NOT offer it otherwise. When none of the video's caption files could be loaded, the transcript MUST say so instead of listing lines.
- **FR-002**: The transcript MUST list every line of the track, in order, each with its start time, as plain text.
- **FR-003**: The transcript MUST show the track the learner selected for captions. With captions off, it MUST show the track captions would use (the remembered language if the video has it, otherwise the default track). It MUST name the language shown, and MUST change when the learner picks another track.
- **FR-004**: While the video plays, the line being spoken MUST be highlighted and kept in view within the panel, without scrolling the page.
- **FR-005**: Choosing a line MUST move the video to that line's start and play.
- **FR-006**: Whether the panel is open MUST be remembered in the browser with the other player preferences, and MUST default to closed.
- **FR-007**: Beside the video on a wide screen, and below it on a narrow one, the panel MUST keep to a limited height and scroll inside itself, with no horizontal scrolling at 375 pixels wide.
- **FR-008**: The transcript MUST come from the same caption files, under the same access, as the captions overlay. Nothing new is asked of the service to show it.

**Transcript search**

- **FR-009**: The course player MUST offer a search of that course's transcripts to an enrolled learner, on the course home and on every lesson.
- **FR-010**: A search MUST run when submitted with 2 to 200 characters after trimming, not on each keystroke.
- **FR-011**: Results MUST be moments: for each, the module and lesson titles, the video's title, the time, and the text around the match with the matching words visually marked. Marking MUST be done on plain text, never by inserting markup from the transcript.
- **FR-012**: Results MUST list at most 20 moments, best match first, and MUST say when there were more.
- **FR-013**: A result's time MUST be the start of the caption line containing the first matching word, so opening it lands just before the words are spoken.
- **FR-014**: Search MUST find words spoken across two neighbouring caption lines, MUST ignore case, and MUST treat English word forms as the same word in English transcripts.
- **FR-015**: For each video, search MUST look in one track: the language the learner has chosen for captions when the video has it, otherwise the video's default track.
- **FR-016**: Choosing a result MUST open the lesson scrolled to that video, with the video moved to the result's time and paused, and a notice of the starting time. The learner's saved resume position MUST NOT change until they play.
- **FR-017**: A lesson address MUST be able to carry a video and a time, so a moment can be opened from a result, bookmarked and shared. It gives no access the lesson address doesn't already give.
- **FR-018**: A failed or timed-out search MUST show a plain message with a way to try again, and MUST NOT affect the rest of the course player.

**Access**

- **FR-019**: Transcript search MUST be refused to anyone who couldn't play the course's videos: signed-out visitors, users who aren't enrolled, and learners whose enrolment is dropped. Enrolled learners of an archived course keep it.
- **FR-020**: Results MUST include only videos the learner could play at that moment: the video, its lesson and its module shown and not archived, and the video ready to play. This MUST be checked against the course's current records on every search, not only against what was stored for search.
- **FR-021**: Results MUST come only from the version of a video the learner would be played, and only from caption tracks that version currently has.
- **FR-022**: The course searched and the learner's identity MUST be taken from the signed-in session and the checked enrolment. Nothing the browser sends MUST be able to widen what is searched.
- **FR-023**: Transcript text MUST NOT be included in any response other than search results and the caption files themselves (for example, not in the course outline).

**Keeping search in step**

- **FR-024**: Transcripts MUST become searchable, without anyone acting, after automatic captions are generated and after an instructor uploads a track.
- **FR-025**: Text MUST stop being searchable, and stop being stored for search, after its track is replaced or removed, its video is replaced or deleted, or its video, lesson or module is hidden, archived or deleted. It MUST return when a hidden video, lesson or module is shown again.
- **FR-026**: These updates MUST settle on the current state however the underlying changes are delivered: twice, late, out of order, or with two updates for the same video running at once.
- **FR-027**: A failure to update search MUST NOT fail or delay the instructor's change or the captioning of a video, and MUST be retried.
- **FR-028**: An operator MUST be able to rebuild every stored transcript from the course records and caption files, for one course or all, removing anything stale. Running it twice leaves the same result.

**Accessibility**

- **FR-029**: The "Transcript" control MUST say whether the panel is open, and the panel MUST be a labelled region naming the language.
- **FR-030**: Every transcript line MUST be operable with the keyboard. The list MUST be a single Tab stop, with Up, Down, Home and End moving between lines and Enter or Space choosing one, and these keys MUST NOT trigger the player's own shortcuts while focus is in the transcript.
- **FR-031**: The current line MUST be identified to assistive technology as current, and MUST NOT be announced on its own as playback moves on.
- **FR-032**: When the learner scrolls the transcript or moves focus within it, the panel MUST stop following playback until the learner chooses "Jump to current line" or chooses a line. Following MUST move without animation when the learner prefers reduced motion.
- **FR-033**: The search box MUST have a visible label or accessible name, the number of results MUST be announced when they arrive, and each result MUST be a single link whose name reads as lesson, video, time and text.
- **FR-034**: Buttons MUST carry text labels with no arrow icons (repository convention).

**Later use and local development**

- **FR-035**: What is stored for search MUST be passages of a few sentences, each knowing its course, module, lesson, video, video version, track, language and time span, so that a later feature (the AI tutor, #289) can retrieve passages for a lesson or a course under the same access rule without re-processing captions.
- **FR-036**: The whole feature MUST work in local development with no AWS account: the panel with the local placeholder captions and uploaded tracks, and search against the local search service.

### Key Entities

- **Transcript line (cue)**: one caption line as the caption file holds it: start time, end time and text. Not stored anywhere new; read from the caption file.
- **Caption track**: one language's captions for one version of a video, generated automatically or uploaded. Exists today; a video has at most 10 and one default.
- **Transcript passage**: what is stored for search: a few neighbouring lines of one track joined into a short text, with the course, module, lesson, video, video version, track, language, whether the track is the video's default, the passage's start and end time, and where each line starts within it. Derived entirely from the course records and caption files; it can always be rebuilt from them.
- **Moment (search result)**: one place in one video where the searched words are said: the lesson and video it's in, the time, and the text around the match.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner can go from a playing video to reading its full transcript in one action, and from any transcript line to that moment in the video in one action.
- **SC-002**: The highlighted line is never more than one line behind what is being spoken during normal playback, at every playback speed.
- **SC-003**: Searching a phrase of two or more words that is spoken in a captioned, shown video of the course returns that moment in the first 5 results, and opening it puts the video within 5 seconds before the phrase.
- **SC-004**: With search warm, results appear within 2 seconds of submitting, for 95% of searches, in a course of 200 videos.
- **SC-005**: In tests covering every refusal case (signed out, not enrolled, dropped, hidden or archived video, lesson and module, replaced version, removed track), transcript text is returned in none of them.
- **SC-006**: A caption or visibility change is reflected in search within 1 minute, for 95% of changes.
- **SC-007**: A keyboard-only learner can open the transcript, move to any line and jump the video there, and run a search and open a result, without a mouse.
- **SC-008**: At 375 pixels wide, the lesson page with the transcript open and the results page have no horizontal scrolling and every control is reachable.
- **SC-009**: After the rebuild is run on a stage, every captioned video a learner can watch is searchable and no text is stored for a video that isn't.

## Assumptions

- **Students only.** The panel and the search are in the student portal's course player. The instructor's preview, the public course preview video and the admin portal are out of scope.
- **One language at a time.** Search looks in one track per video (see Clarifications). Searching every language at once is out of scope.
- **Search is within one course**, from inside it. Searching transcripts across all of a learner's courses, or from the catalogue search box, is out of scope.
- **Video speech only.** Text lessons, quiz questions, discussions and file contents aren't searched.
- **Lines are shown as the caption file has them.** Merging lines into paragraphs, speaker names, and editing a transcript in the portal are out of scope. An instructor corrects a transcript by uploading a track, as today.
- **No find-in-transcript box in the panel.** The whole transcript is on the page, so the browser's own find works on it.
- **No download of the transcript** as a file.
- **Automatic captions are in English** (today's behaviour). Tracks in other languages exist only when an instructor uploads them, until machine-translated tracks arrive (#593, a separate spec). This feature handles any track's language the same way, so those tracks will be shown and searched with no further change.
- **English gets word-form matching; other languages match on whole words.** Languages written without spaces (Chinese, Japanese, Thai) are matched character by character, which finds text but ranks it less well. Per-language handling is a follow-up.
- **Search shows the best 20 moments.** There is no paging, no filters and no sorting options in this version.
- **A result opens paused.** Browsers block video that starts with sound without a gesture, and a learner arriving from a shared link shouldn't be surprised by audio.
- **Search follows changes within about a minute**, not instantly. In that minute nothing hidden is ever shown (FR-020); the only effect is that brand-new text isn't found yet.
- **The AI tutor (#289) is a separate spec.** This feature stores passages in a shape it can use (FR-035) and builds nothing else for it.
- **Nothing about what learners search is recorded.**
- **Dependencies**: caption generation and upload (#371), the shared player (#277), the course search service and its change feed (the Search design page). All exist.
