# Feature Specification: Machine-Translated Caption Tracks

**Feature Branch**: `20261120-154712-caption-translation` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Issue #593: machine-translated caption tracks. After a video's source-language captions are ready, translate them into the target languages the instructor chose for the course and store each as a WebVTT track with the same cue timings. Label them as auto-translated in the captions menu. An instructor-uploaded track always takes precedence and is never overwritten. Replacing the video or its source captions regenerates the translated tracks. Local dev gets a stand-in for the translation step. Cost is observable per stage."

**Parent issue**: #593

**Design page**: [`design/video-player`](../../docs/src/content/docs/en/design/video-player.mdx) (gains a "Translated captions" section)

## User Scenarios & Testing *(mandatory)*

Today a lesson video gets one automatic caption track, in the one language the stage is set up for, and an instructor can upload more tracks by hand, one per language, up to 10 per video (video player spec, #277 and #371). The player's captions menu already lists every track and remembers the language a student last chose.

This feature fills that menu without the instructor writing a single file. The instructor picks the languages a course's captions should be offered in. Each video's captions are then translated into those languages by machine, with every caption shown at exactly the same moment as in the original. Nothing else about the player, the upload flow or how caption files are protected changes.

Three words are used throughout:

- **Source track**: the track a video's translations are made from. It is the video's default track: the automatic captions, or the instructor's own file when they replaced or supplied it.
- **Translated track**: a track made by machine translation from the source track.
- **Caption languages** of a course: the languages the instructor chose for translated tracks.

### User Story 1 - Read captions in my own language (Priority: P1)

A student studying outside their first language opens the captions menu on a lesson video and finds their language in it, marked as auto-translated, for example "Español (auto-translated)". They pick it. The captions appear in step with the speech, as the original captions do. The next video they open in any course that offers that language shows it straight away, because the player remembers the language they chose.

**Why this priority**: This is the reason for the feature. Learners understand more with captions in their own language, and the menu is already there.

**Independent Test**: Open a video of a course that has Spanish as a caption language, pick "Español (auto-translated)" in the captions menu, and check Spanish captions show at the same times as the English ones. Open a second video and check Spanish is already on.

**Acceptance Scenarios**:

1. **Given** a video with a source track and a translated Spanish track, **When** a student opens the captions menu, **Then** it lists the source track as today and "Español (auto-translated)" after it.
2. **Given** the student picks the translated track, **When** the video plays, **Then** each caption appears and disappears at the same time as the matching caption of the source track.
3. **Given** the student picked Spanish on one video, **When** they open another video that has a Spanish track, **Then** Spanish captions are shown without picking again.
4. **Given** a video with no translated track yet (still being made, failed, or the course has no caption languages), **When** a student opens it, **Then** the video plays and the menu shows the tracks that exist, exactly as today.
5. **Given** a student who may not play the video, **When** they request a translated track, **Then** it is refused exactly as the video and its other tracks are.
6. **Given** a published course's preview video on its public page, **When** a visitor opens the captions menu, **Then** the translated tracks are offered there too.

---

### User Story 2 - Choose a course's caption languages once (Priority: P1)

An instructor opens a course's settings, ticks the languages its captions should be offered in, and saves. From then on every video in the course gets a translated track per chosen language shortly after its captions are ready: videos already in the course, videos added later, and videos re-uploaded later. The instructor does nothing per video.

**Why this priority**: Without a way to choose languages there is nothing to translate into. Doing it per course, not per video, is what makes it effortless.

**Independent Test**: As an instructor, tick Spanish and French on a course with one ready video, and check both tracks appear on that video. Add a second video and check it gets both tracks with no further action.

**Acceptance Scenarios**:

1. **Given** a course with no caption languages, **When** the instructor opens its settings, **Then** they see the list of supported languages, each named in English and in the language itself, none ticked.
2. **Given** the instructor ticks Spanish and French and saves, **When** a video in the course already has a source track, **Then** it gets a Spanish and a French translated track without further action.
3. **Given** a course with caption languages, **When** the instructor adds a new video and its captions become ready, **Then** the video gets a translated track per language without further action.
4. **Given** a course with caption languages, **When** a video is replaced and the new version's captions become ready, **Then** the new version gets a translated track per language without further action.
5. **Given** a language that is the same as a video's source track, **When** translations are made, **Then** no translated track is made for that language on that video.
6. **Given** a user who is not an instructor of the course, **When** they try to change its caption languages, **Then** it is refused.
7. **Given** the instructor tries to choose more languages than the stage allows, **When** they save, **Then** it is refused with a message stating the limit.
8. **Given** a stage where caption translation is turned off, **When** the instructor opens the settings, **Then** the language choice is shown as unavailable with a short explanation, and nothing is translated.

---

### User Story 3 - My own captions always win (Priority: P1)

An instructor who has a human-made Spanish caption file uploads it, as they can today. It is used instead of the machine translation, at once and for good: no later translation run replaces it. If they remove their file, the machine translation for that language comes back.

**Why this priority**: The issue's second acceptance criterion. An instructor must be able to trust that their own work is never replaced by a machine's.

**Independent Test**: On a video with a translated Spanish track, upload a Spanish file; check the menu now shows the uploaded track without "(auto-translated)". Replace the source captions; check the Spanish track is still the uploaded one.

**Acceptance Scenarios**:

1. **Given** a translated Spanish track, **When** the instructor uploads a Spanish file, **Then** the upload replaces the translated track and the menu no longer marks Spanish as auto-translated.
2. **Given** an uploaded Spanish track, **When** translations are made again for any reason, **Then** the uploaded track is untouched and no translated Spanish track is added.
3. **Given** an upload and a translation for the same language finish at the same moment, **When** both are applied, **Then** the upload is the track that remains.
4. **Given** the instructor removes their uploaded Spanish track and Spanish is still a caption language of the course, **When** the removal is saved, **Then** a translated Spanish track is made again.
5. **Given** a video that already has 10 tracks, some of them translated, **When** the instructor uploads a file in a language that has no track yet, **Then** the upload is accepted and one translated track makes room for it.

---

### User Story 4 - Translations follow the source (Priority: P2)

Translated tracks are never left describing something else. When the instructor replaces the video, corrects the source captions, or changes the course's caption languages, the translated tracks are brought back in line without anyone asking.

**Why this priority**: A translation of captions that no longer exist is worse than none. It comes second only because it builds on Stories 1 to 3.

**Independent Test**: On a video with translated tracks, upload a corrected file in the source language; check each translated track is replaced by a translation of the new file. Untick a language on the course; check its translated tracks disappear from every video.

**Acceptance Scenarios**:

1. **Given** a video with translated tracks, **When** the instructor replaces the source track with a corrected file, **Then** every translated track is replaced by a translation of the corrected file.
2. **Given** a video being replaced, **When** the new version is still processing, **Then** students keep playing the old version with its own source and translated tracks, and the new version's translated tracks are made only from the new version's captions.
3. **Given** a course with Spanish and French, **When** the instructor unticks French, **Then** the translated French tracks are removed from every video of the course, and uploaded French tracks stay.
4. **Given** a course with Spanish, **When** the instructor also ticks German, **Then** only German is translated: the existing Spanish tracks are not made again.
5. **Given** a video whose source track is removed and no other track takes its place, **When** the removal is saved, **Then** its translated tracks are removed.
6. **Given** nothing about a video's source track or the course's caption languages changed, **When** the instructor edits anything else (title, description, order), **Then** nothing is translated again.

---

### User Story 5 - A failed translation never gets in the way (Priority: P2)

Translation can fail: the service is unavailable, a language pair is refused, the captions are too long. When it does, the video stays playable, the source captions stay, and any translated tracks that were made stay. The instructor sees, per language, whether a track is translated, uploaded, still being made, or failed, and can ask for the failed ones to be tried again.

**Why this priority**: The issue's third acceptance criterion. It is P2 because it protects Stories 1 and 2, which have to exist first.

**Independent Test**: Make translation fail for one language (the local stand-in can be told to). Check the video plays with its source captions and its other translated tracks, the instructor's captions dialog says that language failed, and "Translate again" produces the track once the cause is gone.

**Acceptance Scenarios**:

1. **Given** translation fails for one language of a video, **When** a student opens the video, **Then** it plays, the source track is offered, and every translated track that was made is offered.
2. **Given** that failure, **When** the instructor opens the video's captions dialog, **Then** the language is listed as "Translation failed" with a "Translate again" action, and the other languages show their own state.
3. **Given** the instructor chooses "Translate again", **When** the translation succeeds, **Then** the track appears and the failed state is gone.
4. **Given** translations are still being made, **When** the instructor opens the dialog, **Then** the languages without a track yet are listed as "Translating".
5. **Given** a video's automatic captions are in a different language from the one the course says it is taught in, **When** translations would be made, **Then** none are made and the dialog explains that the instructor should upload captions in the video's language first.
6. **Given** a video with no captions at all (none generated, none uploaded), **When** the course has caption languages, **Then** nothing is translated and the dialog says translations need captions first.

---

### User Story 6 - See and bound what translation costs (Priority: P3)

Machine translation is paid for by the amount of text translated, and the platform pays, not the instructor. An operator can see, for each deployed stage, how much text was translated per day and into which languages, and can limit how many caption languages a course may have or turn the feature off for a stage.

**Why this priority**: The issue asks for cost to be observable per stage. It doesn't change what learners or instructors see, so it comes last, but the feature must not ship to production without it.

**Independent Test**: Translate one video on a deployed stage and find, in that stage's monitoring, the amount of text translated and the number of tracks made, split by target language.

**Acceptance Scenarios**:

1. **Given** translations ran on a stage, **When** an operator looks at that stage's monitoring, **Then** they see the amount of text translated, the tracks made and the failures, per day and per target language, for that stage alone.
2. **Given** two stages in one account, **When** an operator looks at the figures, **Then** each stage's are separate.
3. **Given** a stage's limit of caption languages per course is 3, **When** an instructor chooses a fourth, **Then** it is refused.
4. **Given** a stage with translation turned off, **When** captions become ready, **Then** nothing is translated and nothing is charged.
5. **Given** a source track longer than the translation size limit, **When** translations would be made, **Then** none are made, the dialog says the captions are too long to translate, and nothing is charged.

---

### Edge Cases

- **No room under the 10-track limit**: a video with uploaded tracks in languages the course didn't choose can have fewer than nine free places. Translated tracks fill the free places in the order the course lists its languages. A language left out is shown to the instructor as "No room (10 tracks at most)".
- **Source track changes while a translation is running**: a translation of a source track that has since been replaced is discarded, never shown.
- **Video replaced while a translation is running**: the result is for the old version and is discarded; the new version is translated from its own captions.
- **Video, lesson or course deleted while a translation is running**: the result is discarded and no file is left behind.
- **The same change is processed twice, or two changes out of order**: the outcome is the same as processing the latest once. No duplicate track appears and no language is translated twice for the same source.
- **Caption languages changed twice quickly**: the videos end up matching the last saved choice.
- **Archived course, module, lesson or video**: archived content is read-only, so its caption languages can't be changed. Its existing tracks stay.
- **Draft courses**: translations are made for drafts too, so an instructor can check them before publishing.
- **A caption with no words** (music, a pause): it stays in the translated track, empty or unchanged, at the same time.
- **Captions carrying formatting or speaker marks**: translated captions are plain text. Formatting marks are dropped, the words are kept.
- **Text that looks like markup after translation**: translated text is shown as plain text only, as every caption is.
- **Right-to-left languages** (Arabic): shown by the player as any other track.
- **A language the translation service stops supporting**: it is reported as failed for that language. Other languages are unaffected.
- **A student has a translated language remembered, and the track is later removed**: the player falls back as it does today for a missing language (the default track if captions are on).
- **Course preview videos**: translated from the preview's automatic captions, the same way as lesson videos. A preview has no uploaded tracks today, so precedence doesn't arise.

## Requirements *(mandatory)*

### Functional Requirements

**Choosing languages**

- **FR-001**: An instructor of a course MUST be able to choose and change the course's caption languages from the supported list. No one else may.
- **FR-002**: The supported list MUST be the languages a caption track can already be uploaded in, limited to those the translation service supports. A course MUST NOT have more caption languages than nine, or than the stage's own limit when that is lower.
- **FR-003**: The language choice MUST show each language's English name and its name in the language itself.

**Making translated tracks**

- **FR-004**: When a video's source track becomes ready and its course has caption languages, a translated track MUST be made for each of those languages without any instructor action. This covers new videos, replaced videos, and videos that already existed when the languages were chosen.
- **FR-005**: The source track MUST be the video's default track. No translated track is made for the source track's own language.
- **FR-006**: A translated track MUST have exactly the source track's captions: the same number, in the same order, each with the same start and end time. Only the words differ.
- **FR-007**: A translated track MUST be a caption track like any other: one per language, counted in the 10-track limit, stored and served with the same access rules as the video's other tracks, and never the default track.
- **FR-008**: Translated captions MUST be plain text.
- **FR-009**: Course preview videos MUST get translated tracks by the same rules as lesson videos.

**Labelling**

- **FR-010**: In the captions menu a translated track MUST be shown as the language's own name followed by "(auto-translated)", for example "Español (auto-translated)". Tracks that aren't translated keep their label unchanged.
- **FR-011**: Wherever an instructor sees a video's tracks, each MUST be marked as automatic, uploaded or auto-translated.

**Instructor uploads take precedence**

- **FR-012**: A translated track MUST NEVER replace, change or remove an uploaded track. Where an uploaded track exists for a language, no translated track exists for it.
- **FR-013**: Uploading a track in a language that has a translated track MUST replace the translated track.
- **FR-014**: Uploading a track when the video is at the 10-track limit MUST succeed if at least one of the tracks is translated. The translated track for the language last in the course's list is removed to make room.
- **FR-015**: Removing an uploaded track in one of the course's caption languages MUST bring that language's translated track back.
- **FR-016**: An instructor MUST NOT be able to remove a single translated track from one video. They replace it by uploading their own, or remove the language from the course.

**Keeping translations current**

- **FR-017**: When a video's source track is replaced, every translated track of that video MUST be replaced by a translation of the new source track.
- **FR-018**: When a video is replaced, the new version's translated tracks MUST be made from the new version's captions only. The old version keeps its tracks until it stops being played, as it does today.
- **FR-019**: When a language is added to a course, only that language MUST be translated, for every video of the course that has a source track. When a language is removed, its translated tracks MUST be removed from every video of the course, and uploaded tracks MUST stay.
- **FR-020**: When a video's source track is removed and no other track becomes the default, its translated tracks MUST be removed.
- **FR-021**: A change that affects neither a video's source track nor its course's caption languages MUST NOT cause any translation.
- **FR-022**: A translation result MUST only ever be applied to the video version and the source track it was made from. Applying the same result twice, or results out of order, MUST leave the same tracks as applying the latest once.

**Failure**

- **FR-023**: A translation that fails, is slow or never finishes MUST NOT affect whether a video is ready or playable, its source track, or its other tracks.
- **FR-024**: A failure for one language MUST NOT stop the other languages of the same video, or other videos, from being translated.
- **FR-025**: The instructor MUST see, per video and per caption language, one of: translated, uploaded by you, translating, failed, no room, or not translated with the reason (no captions yet, captions too long, captions not in the course's language).
- **FR-026**: The instructor MUST be able to ask for a video's missing translations to be tried again.
- **FR-027**: Automatic captions MUST NOT be translated when the course states a teaching language and the automatic captions are in a different one. Captions the instructor uploaded are always trusted.

**Cost and operation**

- **FR-028**: Each stage MUST record how much text it sent for translation, how many translated tracks it made and how many translations failed, per target language, so that an operator can read them per day for that stage alone.
- **FR-029**: Each stage MUST be able to turn caption translation off and to set a lower limit on caption languages per course. With translation off, nothing is translated, the language choice is shown as unavailable, and existing translated tracks stay.
- **FR-030**: A source track MUST NOT be translated when its text is longer than a fixed size limit (300,000 characters, several times a long lecture). It is reported as "captions too long".
- **FR-031**: The same source track MUST NOT be translated into the same language twice unless the instructor asks for it again or an earlier attempt failed.
- **FR-032**: The translation step MUST have only the access it needs: to translate text, to read and write caption files of lesson and preview videos, and to read and update the records that hold their tracks. It MUST NOT be able to read videos, uploads or students' data.

**Local development and consistency**

- **FR-033**: The whole flow MUST work in local development with no cloud account, using a stand-in for the translation step that produces a recognisable placeholder translation for each language, keeps every caption's timing, and can be made to fail on purpose so the failure path can be tested.
- **FR-034**: The rules several writers keep (a translated track never coexists with an uploaded one in its language, is never the default, always names the source track it came from, and only exists for a language the course chose) MUST be enforced where the track list is computed, and checked by the data-consistency checks that run after every end-to-end test.

### Key Entities

- **Caption languages (of a course)**: the ordered list of languages the instructor chose for translated tracks. At most nine, or the stage's limit. Empty by default.
- **Caption track**: as today (one file for one version of a video, with a language, a label and whether it is the default), with a third origin beside automatic and uploaded: translated. A translated track also records which source track it was made from, so a stale one can be told apart.
- **Translation outcome (of a video version)**: for the current source track, the languages that could not be translated and why. It lets the instructor's view tell "failed" from "still translating".
- **Stage translation settings**: whether translation is on, and the most caption languages a course may have.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a course with caption languages, 95% of videos up to two hours long have every translated track within 15 minutes of their source captions becoming ready, with no instructor action.
- **SC-002**: In every translated track, the number of captions and each caption's start and end time equal the source track's, in 100% of tracks checked.
- **SC-003**: 0 uploaded tracks are ever replaced, changed or removed by a translation, including when an upload and a translation finish at the same moment.
- **SC-004**: 100% of videos remain playable with their source captions whatever happens to translation.
- **SC-005**: After the source track or the caption languages change, no translated track made from an earlier source track, or for a language no longer chosen, is offered to students once the change has been processed.
- **SC-006**: A student can switch to captions in their language within two interactions from a playing video, and finds them already on for the next video.
- **SC-007**: An operator can state how much text a stage translated on a given day, per target language, from that stage's monitoring alone.
- **SC-008**: Editing a video's title or description, or saving a course with unchanged caption languages, causes 0 new translations.
- **SC-009**: The data-consistency check passes after every end-to-end test.

## Assumptions

- The translation service is Amazon Translate, the managed translation service of the one cloud the project targets. Its translation quality for lecture speech and its unit cost are to be checked on the development stage before production is turned on (the issue asks for this); the tasks carry that check for a person to do.
- Translation is caption by caption: each caption's words are translated on their own, which is what keeps every timing identical. A sentence that runs across several captions can read less smoothly than a human translation would. This matches the "raw machine-translated subtitles are usable for following content" finding the issue cites, and an instructor can always upload a better file.
- The automatic captions are still made in the stage's one configured language (video player spec). Choosing the transcription language per course is a separate change; until then FR-027 stops captions transcribed in the wrong language from being translated.
- The words "(auto-translated)" are in English, like the rest of the player, until the portals are localised (#292).
- An instructor cannot edit a translated track in place or download it. To correct one they upload their own file for that language.
- Translated tracks are made for draft courses as well as published ones.
- The existing caption rules stay: WebVTT only, at most 10 tracks per video version, one per language, the same signed access as the video, and an old version keeps its tracks until it is retired.
- The transcript panel and transcript search (#590) show whichever track is selected, so a translated track works there with no change from this feature. It is a related feature, specified separately.
- Out of scope: AI dubbing, translating the portal interface (#292), translating lesson text, quizzes or course descriptions, showing a course's caption languages in the catalogue or as a search filter, detecting a video's spoken language, and custom glossaries for subject terms.
