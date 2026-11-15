# Feature Specification: Video Player Upgrades

**Feature Branch**: `spec/video-player` (spec folder `20261115-204517-video-player`)

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Video player upgrades (issue #277): resume from the last watched position, playback speed, keyboard shortcuts, remembered volume and speed, and captions (auto-generated, WebVTT, instructor upload/replace/remove), with a local stand-in for the caption generation step."

**Issue**: #277

## Clarifications

### Session 2026-11-15

- Q: Is the resume position kept per student or per device? → A: Per student per video item, on the server, so it follows the student across devices.
- Q: When does a video start from the beginning instead of resuming? → A: When the saved position is within the last 10 seconds or past 95% of the video, the student is treated as having finished it and the next visit starts at 0:00. Saving a position in that range stores "start over".
- Q: What happens to a saved position when the instructor replaces the video? → A: It is ignored (the new video is a different recording). The student starts at 0:00 once the new version is playing.
- Q: How often is the position saved? → A: About every 10 seconds while playing, and on pause, seek end and when the student leaves the page, best effort. A lost save costs at most about 10 seconds of resume accuracy.
- Q: Does watching count as student activity, or complete the item? → A: Neither. Marking the item done stays the student's own action, and a resume record does not make the item "used" for the purpose of refusing permanent deletion.
- Q: Does an archived course save positions? → A: No. Archived courses are read-only, so nothing is saved, but the student may still resume from a position saved earlier.
- Q: Where do speed, volume, mute and captions on/off live? → A: In the browser (per device), not on the server. Defaults: 1x, full volume, unmuted, captions off.
- Q: Which speeds? → A: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 1.75x, 2x.
- Q: Which caption formats and limits? → A: WebVTT only (no conversion from SRT or others), at most 1 MB per file, at most 10 tracks per video, one track per language.
- Q: Which track is on by default? → A: The auto-generated one, as the default track the player offers. Whether it is shown is the student's remembered captions preference, which starts off.
- Q: Which language does auto-captioning use? → A: One configured default language (en-US). There is no language detection. An instructor whose video is in another language uploads a track by hand.
- Q: What if captions fail or are missing? → A: Playback is never blocked. The instructor sees the caption status and can always upload a track.
- Q: What happens to captions when the video is replaced? → A: The new version's captions are generated again from the new video and any tracks of the old version are discarded when the swap happens. While the replacement transcodes, students keep playing the old version with its own tracks.
- Q: Does the instructor portal's preview use the same player? → A: Yes, and it also shows the caption status and lets the instructor manage tracks.
- Q: Does an instructor previewing a video get a resume position saved? → A: No. Positions are saved only for enrolled students in the student portal; the preview always starts at 0:00 and saves nothing.
- Q: Which languages can an instructor pick for an uploaded track? → A: A fixed short list (English, Spanish, French, German, Portuguese, Japanese, Chinese, Hindi, Arabic, Vietnamese), each with a standard language tag and a display label. The auto track is always en-US. The list lives in one shared place used by both portals and the API.
- Q: Who may manage a video's captions? → A: The instructors of the course that holds the video, the same people who may attach or replace its video; no one else.
- Q: Can a caption track be uploaded while the video is still transcoding or has failed? → A: No. Tracks attach to a ready version, so upload, replace and remove are refused until the video is ready. Auto captioning starts only after the transcode completes.
- Q: If an instructor uploads a track before the automatic captions finish, which wins for the same language? → A: The upload. A late automatic result never overwrites an uploaded track.
- Q: What does the student see while a replacement video is transcoding? → A: The old version with its own tracks and the student's own saved position, unchanged, until the swap. After the swap the position is ignored (FR-005).
- Q: Is a student's speed/volume choice shared between the student and instructor portals? → A: No. Each portal is its own browser origin, so preferences are kept separately per portal, per device.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick up where I left off (Priority: P1)

A student watching a lesson video leaves (closes the tab, navigates away, reloads, or comes back the next day on another device). When they open the video again it starts at the point where they stopped, within a few seconds, and says so.

**Why this priority**: Resume is the most-requested learner feature and the issue's first acceptance criterion. It delivers value alone.

**Independent Test**: Enrol a student, play a video for 40 seconds, reload the lesson, and check playback starts near 0:40 (within 10 seconds earlier). Then finish the video, reload, and check it starts at 0:00.

**Acceptance Scenarios**:

1. **Given** an enrolled student watching a video, **When** they reload the lesson, **Then** the video is positioned within 10 seconds before where they stopped and does not start playing by itself.
2. **Given** the same student on a different device, **When** they open the video, **Then** it resumes from the same saved position.
3. **Given** a student who watched to within the last 10 seconds or past 95% of the video, **When** they open it again, **Then** it starts at 0:00.
4. **Given** a student with no saved position, **When** they open the video, **Then** it starts at 0:00.
5. **Given** a saved position and an instructor who then replaces the video, **When** the new version is playing for the student, **Then** it starts at 0:00 and the old position is not used.
6. **Given** a student in an archived course with a saved position, **When** they watch, **Then** it resumes from the saved position but no new position is saved.
7. **Given** a saved position, **When** the student sees the player, **Then** a short note such as "Resumed at 4:12" is shown with a way to start over from 0:00.
8. **Given** another enrolled student, **When** they request or save a position for the same video, **Then** they read and write only their own.

---

### User Story 2 - Watch at my own pace with the keyboard (Priority: P1)

A student changes playback speed, adjusts volume and uses keyboard shortcuts. Their speed and volume stick for the next video, and the next visit.

**Why this priority**: Speed and shortcuts are the other half of the issue's player expectations, and need no backend.

**Independent Test**: Open a video, set 1.5x and volume 40%, press shortcuts, open another video and reload, and check speed and volume are unchanged.

**Acceptance Scenarios**:

1. **Given** a video, **When** the student picks a speed from the control bar, **Then** playback uses it immediately and the control shows it.
2. **Given** a chosen speed and volume, **When** the student opens another video or reloads, **Then** the same speed, volume and mute state are applied.
3. **Given** the player has focus, **When** the student presses a shortcut, **Then** it does what the table below says; when focus is elsewhere (a text field, the quiz below), the keys do nothing to the video.
4. **Given** a browser that blocks storage, **When** the student opens a video, **Then** it plays with defaults and the preferences simply don't persist, with no error shown.
5. **Given** the controls, **When** used with a keyboard or screen reader, **Then** every control is reachable, labelled and announces its state (playing, muted, speed, captions on).

Shortcuts (player focused): Space or K play/pause; J / L back / forward 10 s; Left / Right back / forward 5 s; Up / Down volume up / down 5%; M mute; C captions; F fullscreen; < / > slower / faster; 0 to 9 jump to 0% to 90% of the video.

---

### User Story 3 - Read along with captions (Priority: P1)

A student turns captions on. Videos transcribed automatically offer a default track; a student can pick another language track when the instructor provided one. The choice to see captions is remembered.

**Why this priority**: The issue's second acceptance criterion; captions matter for accessibility and for watching without sound.

**Independent Test**: Upload a video, wait for its captions, open it as a student, toggle captions on and check text appears in sync; reload and check captions are still on.

**Acceptance Scenarios**:

1. **Given** a video that finished transcoding and captioning, **When** a student opens it, **Then** the player offers a captions control with the default track.
2. **Given** that control, **When** the student toggles captions on and off, **Then** caption text shows and hides, and the choice is remembered on that device.
3. **Given** a video with several tracks, **When** the student opens the captions menu, **Then** they can pick a track by its language label.
4. **Given** a video with no tracks (captioning pending, failed or the video has no speech), **When** the student opens it, **Then** the video plays normally and the captions control is absent or disabled with an explanation.
5. **Given** a student without access to the video (not enrolled, hidden, wrong course), **When** they request a caption track, **Then** it is refused exactly as the video itself is.

---

### User Story 4 - Auto-generated captions for new videos (Priority: P2)

When an instructor uploads a video, captions are produced automatically after it is transcoded, without any extra step, and the video is playable the moment its transcode finishes whether or not captions are ready.

**Why this priority**: Gives every video a default track without instructor effort, but depends on stories 3 and on the transcode pipeline that already exists.

**Independent Test**: Upload a video locally and check a default track appears after the transcode; in the deployed pipeline check a caption file appears for a video with speech.

**Acceptance Scenarios**:

1. **Given** an instructor uploads a video, **When** its transcode completes, **Then** captioning starts automatically and the video is ready for students without waiting for it.
2. **Given** captioning finishes, **When** the instructor or a student opens the video, **Then** the auto-generated track is listed as the default.
3. **Given** captioning fails (no speech, unsupported audio, service error), **When** the instructor opens the video, **Then** the status says captions could not be generated and they can upload one; students see a normal video without captions.
4. **Given** an instructor replaces a video, **When** the replacement completes, **Then** the new version's captions are generated again and the old version's tracks are discarded when it is retired; until then students play the old version with its own tracks.
5. **Given** a completion notification that arrives twice or after a later replacement, **When** it is processed, **Then** it never attaches tracks to the wrong version.

---

### User Story 5 - Upload, replace and remove captions (Priority: P2)

An instructor adds a WebVTT file in a chosen language, replaces the auto-generated track with a corrected one, or removes a track. They see each video's caption status in the instructor portal and preview it with the same player.

**Why this priority**: Auto captions are imperfect and some videos have no usable speech; this lets instructors fix both. The core flow works without it.

**Independent Test**: As an instructor, upload a valid .vtt for a language, check it appears in the preview and for students; upload for the same language and check it replaces it; remove it.

**Acceptance Scenarios**:

1. **Given** an instructor of the course and a ready video, **When** they upload a valid WebVTT file of at most 1 MB with a language, **Then** it becomes a track students can pick.
2. **Given** an existing track in that language (including the auto one), **When** they upload another, **Then** it replaces it, and is the default if it replaced the auto track.
3. **Given** a track, **When** the instructor removes it, **Then** students no longer see it; if it was the default another becomes default or none does.
4. **Given** a file that is not WebVTT, larger than 1 MB, or an eleventh track, **When** uploaded, **Then** it is refused with a clear message and nothing changes.
5. **Given** an instructor of another course, a student, or a user who isn't an instructor, **When** they try to manage captions, **Then** it is refused.
6. **Given** the instructor portal preview, **When** the instructor plays the video, **Then** the same player with the same controls and tracks is used, and the caption status (generating, ready, failed) is visible.
7. **Given** a replaced or removed track file, **When** the player later asks for it, **Then** the student never sees a stale cached version of the old file.

---

### Edge Cases

- A student's position save arrives after the item was hidden or deleted: it is refused or ignored and never makes the item or its parents appear to have student activity.
- Saves arrive out of order or from two tabs: the most recent save wins; a position is never negative or beyond a sane maximum; garbage values are refused.
- The video is shorter than 10 seconds: it is treated as finished only when played to its end.
- The student seeks backwards after finishing: the new position is saved normally.
- The saved position is beyond the new video's length for any other reason: playback starts at 0:00.
- Signed access to the video has expired while the page was open: the player refetches access and carries on at the current position, and caption fetches succeed under the same access as the video.
- A caption file is fetched by the browser from another origin than the portal: it must work with the video's signed access and the portal's origin, including in the instructor portal.
- Captions for a video with no audio track: captioning fails cleanly, with no retry loop.
- A WebVTT file with a byte order mark, Windows line endings or non-Latin text is accepted and shown correctly.
- A file whose name or content tries to inject markup into the captions display is shown as plain text only.
- Two instructors upload a track for the same language at once: one wins; the other's file is not left behind.
- The video is replaced while an instructor is uploading a track for the old version: the upload is refused with a message to retry on the new version.
- The browser lacks fullscreen or the speed API: the matching control is hidden, the rest works.
- Reduced-motion and high-contrast settings are respected by the control bar.

## Requirements *(mandatory)*

### Functional Requirements

**Resume**

- **FR-001**: The player MUST resume an enrolled student's video from their last saved position (within 10 seconds before it) without starting playback by itself, and MUST tell the student, with a way to start over.
- **FR-002**: A position MUST be saved about every 10 seconds while playing and when the student pauses, finishes seeking or leaves the page, best effort; a failed save MUST NOT interrupt playback or show an error.
- **FR-003**: Positions MUST be stored per student per video item on the server, readable and writable only by that student while enrolled, and MUST follow the student across devices.
- **FR-004**: A position within the last 10 seconds or past 95% of the video MUST be stored and treated as "start over".
- **FR-005**: A saved position MUST be ignored once the item's video is replaced by a new version (a different recording), without any write by the replacing instructor.
- **FR-006**: Saving MUST be refused for items that are hidden or archived, or in an archived course; reading a previously saved position for an item the student can see MUST still work after the course is archived.
- **FR-007**: Saving a position MUST NOT count the student as active for the item, MUST NOT mark it done, and MUST NOT change progress or counted records.
- **FR-008**: The server MUST reject negative, non-numeric or implausibly large positions.
- **FR-008a**: The instructor preview MUST NOT save or resume positions.

**Speed, volume, shortcuts, controls**

- **FR-009**: The player MUST replace the browser's native controls with an accessible control bar: play/pause, seek bar with elapsed and total time, volume with mute, speed, captions, fullscreen where available.
- **FR-010**: Speed MUST be selectable from 0.5x to 2x in the listed steps and applied immediately.
- **FR-011**: Speed, volume, mute and captions on/off MUST be remembered per browser (not on the server), applied to every video, and fall back to defaults silently when browser storage is unavailable.
- **FR-012**: The listed keyboard shortcuts MUST work only while the player or its controls have focus and MUST NOT fire while typing in an input.
- **FR-013**: Every control MUST be keyboard-operable, have an accessible name and announce state changes; the control bar MUST be visible when paused, on keyboard focus, and briefly after pointer or key activity while playing.
- **FR-014**: The existing safeguards MUST be kept: no browser download or remote-playback control, no context menu on the video, and picture-in-picture available.
- **FR-015**: The student portal and the instructor portal MUST use the same shared player.

**Captions**

- **FR-016**: After a video's transcode completes, captioning in one configured default language (en-US) MUST start automatically; the video becomes ready for students without waiting for it.
- **FR-017**: The auto-generated result MUST be stored as a WebVTT track attached to the video version it was made for, and be the default track.
- **FR-018**: A caption outcome (success, failure, duplicate, or arriving after a replacement or deletion) MUST only ever be applied to the version it was made for, and applying it twice MUST be safe.
- **FR-019**: A video MUST hold at most 10 tracks, at most one per language; each track has a language (from a fixed list) and a label.
- **FR-020**: Instructors of the course MUST be able to upload (WebVTT, at most 1 MB, content checked to be WebVTT), replace (same language) and remove tracks of a ready video, and no one else may; a replacement of the auto track makes the uploaded one the default.
- **FR-021**: Caption files MUST be served only to people allowed to play the video, with the same signed access as the video and no wider than it, and MUST never be stale after a replace or removal.
- **FR-022**: The student's video access answer MUST list the video version's tracks (language, label, default flag, where to fetch) so the player needs no extra lookup; the instructor's preview MUST do the same.
- **FR-023**: Captions failing or being absent MUST NOT block playback or readiness; the instructor MUST see the status (generating, ready, failed, none) and always be able to upload a track.
- **FR-024**: Replacing a video MUST discard its tracks when the replacement takes over, and the old version's tracks MUST stay playable until then.
- **FR-025**: Caption text MUST be shown as plain text only.
- **FR-026**: Captioning MUST work end to end in local development without an AWS account, using a stand-in that writes a placeholder track and reports completion as the real service would; real speech recognition is out of scope locally.

**Rules that span records**

- **FR-027**: Rules that more than one writer keeps (caption outcomes written by the event handler and read by both APIs; track changes by instructor-api) MUST be written through shared helpers and covered by invariant checks with tests that break them.
- **FR-028**: Existing invariants and tests covering content items, student activity counts and progress MUST keep passing unchanged.

### Key Entities

- **Video position**: A student's last position in one video item: student, course and item, position in seconds, which version of the video it refers to, and when it was saved. One per student per item.
- **Caption track**: One WebVTT file for one version of a video: language, label, whether it is the default, whether it was generated or uploaded, and where it is stored. At most 10 per version, one per language.
- **Caption status**: Whether a video version's automatic captioning is pending, ready, failed or not applicable.
- **Player preferences**: Speed, volume, mute and captions on/off, kept in the browser.
- **Video item**: Existing; supplies the video version, its readiness and the access students use to play it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a reload or on another device, 95% of resumed videos start within 10 seconds before where the student stopped.
- **SC-002**: A student can turn captions on or change speed within two interactions from a playing video, with the mouse or keyboard alone.
- **SC-003**: 100% of videos with speech get a default caption track within 15 minutes of becoming ready; 100% of videos remain playable whatever happens to captioning.
- **SC-004**: A student's speed, volume and captions choice survive reload and the next video 100% of the time storage is available.
- **SC-005**: 0 cases where a student reads or writes another student's position, or fetches captions of a video they can't play.
- **SC-006**: Every control is operable by keyboard and has an accessible name, verified by the control tests.
- **SC-007**: A replaced or removed caption track is no longer offered to students on their next page load, and the data-consistency check passes after every test.
- **SC-008**: A saved position never changes a student's progress, completion or activity count.

## Assumptions

- The existing video pipeline (upload, transcode to HLS, signed cookie access under the version's folder, replacement keeping the old version playable) stays as is; captions are added to it.
- Caption files live under the same signed-access folder as their video version, so no new access scope is introduced.
- Captions are fetched with the same credentials as the video; the design of how is for the plan.
- Auto-captioning is one language (en-US); language detection, translation and SRT import are out of scope.
- Caption text editing in the portal is out of scope; instructors edit offline and upload.
- The saved position is per item, not per course; "continue where I left off" across lessons is out of scope.
- A position record for an item that was later deleted is harmless and is left in place, as other student records are.
- A student with two tabs open on the same video gets last-save-wins.
- Resume uses whole seconds; saved precision beyond that is not needed.
- Quality, bitrate and playlist selection controls are out of scope.
- Issue #277 is closed by the final PR of this feature only.
