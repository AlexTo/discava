# Feature Specification: Questions Inside and Straight After Videos

**Feature Branch**: `20261120-002940-in-video-questions` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Issue #591: questions inside and straight after videos. Instructors attach questions to timestamps on a video item. The player pauses at the timestamp, shows the question, gives the explanation after the answer, then resumes. An optional short check at the end of a video. In-video questions are low-stakes: they don't count towards a pass mark or block progress, and a learner can skip one. Answers are recorded so instructors see them in analytics (most-missed questions). Markers on the seek bar; seeking past a question doesn't force it; rewatching doesn't re-ask an answered one unless the learner chooses to. An instructor editor to add, edit, reorder and remove questions on a video's timeline, which behaves like live course editing for quizzes. Companions: 'reveal answers after each attempt' as the default for new quizzes, and a flag in the lesson drop-off view for modules that have video and no questions. Keyboard and screen-reader accessible."

**Parent issue**: #591

**Design pages**: [`design/quizzes`](../../docs/src/content/docs/en/design/quizzes.mdx) (gains a "Questions in videos" section) and [`design/video-player`](../../docs/src/content/docs/en/design/video-player.mdx) (gains a "Questions" section)

## User Scenarios & Testing *(mandatory)*

Today a video item only plays. A quiz is a separate item in the lesson, which a learner can scroll past. This feature lets an instructor put questions on a video itself: at chosen moments, and straight after it ends. The player stops at each one, the learner answers or skips, sees the right answer and the explanation, and the video carries on. Nothing about these questions is graded towards anything: they exist to make the learner recall what they just watched.

In this document a **video question** is a question attached to a video item. A **timed question** has a moment in the video. An **end question** is asked when the video finishes; a video's end questions together are its **end check**.

### User Story 1 - Put questions on a video's timeline (Priority: P1)

An instructor opens a video in the course editor and chooses **Questions**. They play or scrub the video to a moment, add a question there, write the prompt, the options, which are correct, and an optional explanation, the same way they write a quiz question. They can change a question's moment, edit it, remove it, or mark it as an end question. Saving stores all of the video's questions together.

**Why this priority**: Nothing else in this feature can happen until a video has questions. It reuses the question form instructors already know from quizzes.

**Independent Test**: As an instructor, add two timed questions and one end question to a ready video, save, reload the page and reopen the editor: the three questions are there, at the same moments, with the same correct answers.

**Acceptance Scenarios**:

1. **Given** a ready video in a course the instructor teaches, **When** they add a question at 1:30 with two options and one marked correct, and save, **Then** the question is stored at 1:30 and listed on the timeline at that moment.
2. **Given** a video with questions, **When** the instructor changes a question's moment, **Then** the list re-sorts by time and the timeline marker moves.
3. **Given** two questions at the same moment, or two end questions, **When** the instructor reorders them, **Then** learners are asked them in that order.
4. **Given** a question without a correct option, with an empty prompt, or with fewer than two options, **When** the instructor tries to save, **Then** the save is refused and the question is marked as needing a fix, as in the quiz builder.
5. **Given** someone who doesn't teach the course, **When** they try to save questions on its video, **Then** they are refused and nothing changes.
6. **Given** the video, its lesson, its module or its course is archived, **When** the instructor opens the editor, **Then** it is read-only and says what to restore first.
7. **Given** the instructor has unsaved changes, **When** they close the editor, **Then** they are asked to confirm before the changes are lost.
8. **Given** a video with questions, **When** the instructor previews it, **Then** the questions appear as a learner would see them, graded in the browser, and nothing is recorded.

---

### User Story 2 - Be asked a question while watching (Priority: P1)

A learner is watching a video. When playback reaches a question's moment, the video pauses and the question appears over it. They pick an answer and submit, and straight away see whether they were right, which options were correct, and the instructor's explanation. They press **Continue** and the video carries on from where it stopped. They can press **Skip** instead of answering.

**Why this priority**: This is the feature: testing between segments of a video is what the evidence in the issue supports, and it only works if the question sits on the path the learner is already on.

**Independent Test**: Enrol in a course whose video has a question at 0:10. Play the video: it pauses at 0:10 and shows the question. Answer it: the result and explanation show. Press Continue: the video resumes from 0:10.

**Acceptance Scenarios**:

1. **Given** an enrolled learner playing a video with an unanswered question at 0:10, **When** playback reaches 0:10, **Then** the video pauses, the question is shown, and keyboard focus moves to it.
2. **Given** the question is shown, **When** the learner submits an answer, **Then** they see whether it was right, the correct options and the explanation (when there is one), and the answer is recorded.
3. **Given** the result is shown, **When** the learner presses Continue, **Then** the question closes and the video resumes from the moment it paused.
4. **Given** the question is shown, **When** the learner presses Skip, **Then** the question closes, the video resumes, nothing is recorded, and the learner is not asked that question again during this visit to the page.
5. **Given** a learner has answered a question, **When** they watch past its moment again, on this visit or a later one, **Then** the video doesn't pause for it.
6. **Given** a video with no questions, **When** a learner plays it, **Then** it plays exactly as it does today, with no extra controls or pauses.
7. **Given** a learner answers every question on a video wrongly, or skips them all, **When** they look at the lesson, **Then** the video's completion, the lesson's progress, the course's progress and any certificate are exactly what they would have been without the questions.
8. **Given** someone who isn't enrolled in the course, **When** they try to read or answer a video's questions, **Then** they are refused.
9. **Given** a multiple choice question, **When** it is shown, **Then** it says "Select all that apply" and is graded all-or-nothing, as in a quiz.

---

### User Story 3 - See where the questions are, and go back to one (Priority: P2)

The seek bar shows a marker at each question's moment, so a learner knows what's coming and can find a question again. Dragging or jumping past a question doesn't stop the video for it. Choosing a marker opens that question: an unanswered one can be answered, and an answered one shows the learner's answer with the explanation and a **Try again** button for practice.

**Why this priority**: Learners scrub, rewatch and jump. Without these rules the questions either nag or get lost. It builds on Story 2.

**Independent Test**: On a video with questions at 0:10 and 0:40, seek straight to 0:50: no question appears and both markers still show as unanswered. Choose the 0:10 marker: its question opens.

**Acceptance Scenarios**:

1. **Given** a video with questions, **When** the player shows its controls, **Then** the seek bar has one marker per timed question at its moment, and one at the end when there is an end check.
2. **Given** an unanswered question at 0:10, **When** the learner seeks from 0:05 to 0:50 (by dragging, a keyboard shortcut or a number key), **Then** the video doesn't pause for the question.
3. **Given** the learner sought past an unanswered question, **When** they later play through its moment in normal playback, **Then** they are asked it.
4. **Given** a marker, **When** the learner chooses it with the mouse, touch or keyboard, **Then** the video moves to that moment, pauses, and the question opens.
5. **Given** an answered question's marker, **When** the learner opens it, **Then** they see their recorded answer, the correct options and the explanation, with Try again and Close.
6. **Given** the learner presses Try again, **When** they answer, **Then** they see whether the new answer is right, and their recorded answer and the instructor's figures don't change.
7. **Given** markers for answered and unanswered questions, **When** they are shown, **Then** the two states differ by shape or icon as well as colour, and each marker's name says its time and whether it's answered.
8. **Given** a learner leaves the page while a question is open, **When** they come back and resume, **Then** playback resumes just before that question, so it's asked again.

---

### User Story 4 - A short check when the video ends (Priority: P2)

When the video finishes and the instructor has added end questions, the end check starts by itself: the first end question appears in place of the finished video, then the next, and after the last one the learner sees how many they got right. Each can be skipped, and the whole check can be closed.

**Why this priority**: A check straight after the video catches the learner while the content is fresh, and suits instructors who don't want to interrupt the video. It reuses everything from Story 2.

**Independent Test**: On a video with two end questions, play to the end: the first question appears without the learner doing anything. Answer both: a summary says "2 of 2 correct".

**Acceptance Scenarios**:

1. **Given** a video with unanswered end questions, **When** playback reaches the end, **Then** the first unanswered end question is shown, with its place in the check ("Question 1 of 2").
2. **Given** the learner answers or skips an end question, **When** they continue, **Then** the next unanswered end question is shown, and after the last one a summary shows how many of the end questions they've answered correctly.
3. **Given** the learner has answered every end question, **When** the video ends again, **Then** the check doesn't start by itself, and the end marker opens their answers.
4. **Given** a video with timed questions and no end questions, **When** it ends, **Then** nothing more is shown.
5. **Given** the end check is showing, **When** the learner closes it, **Then** they are back at the finished video and can replay or move on, and **Mark as done** works as it does today throughout.

---

### User Story 5 - See which video questions learners miss (Priority: P2)

An instructor opens a course's analytics. Beside the quizzes, it lists the videos that have questions. Opening one shows each question with how many learners answered it, how many got it wrong on their first answer, and the miss rate, most-missed first.

**Why this priority**: The issue asks that instructors see these answers. A question most learners miss tells the instructor which part of the video didn't land.

**Independent Test**: Have five learners answer a video question, three of them wrongly. The instructor's analytics for that video shows the question with 5 answers, 3 misses and a 60% miss rate.

**Acceptance Scenarios**:

1. **Given** a course with a shown video that has questions, **When** the instructor opens the course's analytics, **Then** the video is listed with its number of questions.
2. **Given** learners have answered a video's questions, **When** the instructor opens that video's results, **Then** each current question shows its moment (or "End of video"), the start of its prompt, answers, misses and miss rate.
3. **Given** a question has fewer than 5 answers, **When** results are ranked, **Then** it isn't ranked by miss rate and is listed after the ranked ones, as for quiz questions.
4. **Given** a learner used Try again or skipped a question, **When** the figures are shown, **Then** neither is counted: only each learner's first recorded answer is.
5. **Given** someone who doesn't teach the course, **When** they ask for these results, **Then** they are refused the same way as for an unknown course.
6. **Given** an answer was just recorded, **When** the instructor reloads within about 30 seconds, **Then** the figures include it, as for the other analytics figures.

---

### User Story 6 - Change a video's questions after learners have answered (Priority: P2)

An instructor fixes a wrong answer key, rewords a question, moves it, or removes it, after learners have already answered. The rules are the ones quizzes follow under live course editing: recorded answers are kept and never regraded, a learner in the middle of answering isn't silently graded against something they didn't see, and two editors can't overwrite each other.

**Why this priority**: Published courses are edited while learners are in them. The issue asks for this to behave like quiz editing, and names it in the acceptance criteria.

**Independent Test**: A learner answers a question wrongly. The instructor then changes which option is correct so that the learner's choice is now the right one. The learner's recorded result is still "incorrect", and the next learner is graded against the new key.

**Acceptance Scenarios**:

1. **Given** learners have answered a question, **When** the instructor changes only its correct options or explanation, **Then** recorded answers keep the result they were given, new answers are graded against the new key, and an answered learner who reopens the question sees the current key and explanation beside their recorded result.
2. **Given** a learner has a question on screen, **When** the instructor changes its prompt, its kind or its options and the learner then submits, **Then** nothing is recorded, the learner is told the question was updated, and the updated question is shown for them to answer.
3. **Given** a learner has a question on screen, **When** the instructor removes it and the learner then submits, **Then** nothing is recorded and the video resumes.
4. **Given** a learner answered a question that is later reworded, **When** they watch again, **Then** they aren't asked it again, and their answer still counts in its figures.
5. **Given** a question is removed, **When** the instructor views results, **Then** it is no longer listed. Learners' answers to it are kept.
6. **Given** a question's moment is changed, **When** a learner who hasn't answered it plays through the new moment, **Then** they are asked it there. Learners who already answered aren't asked again.
7. **Given** two instructors have the editor open on the same video, **When** both save, **Then** exactly one save lands and the other is told the questions changed and offered a reload.
8. **Given** learners have answered questions on a video, **When** the instructor opens the editor, **Then** it warns that learners have already used this video and that their answers are kept and not regraded.
9. **Given** learners have answered questions on a video that is later archived, **When** the instructor tries to delete it permanently, **Then** it is refused, as for any item a student has used.

---

### User Story 7 - Nudges towards asking questions (Priority: P3)

Two small changes from the same evidence. A new quiz starts with "Show the correct answers: After each attempt" selected, so feedback is immediate unless the instructor chooses otherwise. And the instructor's lesson drop-off view points out modules that have video and no questions at all.

**Why this priority**: Both are cheap and steer instructors towards what works, but neither is needed for the main feature.

**Independent Test**: Open the quiz builder for a new quiz: "After each attempt" is selected. Open analytics for a course with a module holding only videos without questions: the drop-off view names that module.

**Acceptance Scenarios**:

1. **Given** an instructor starts a new quiz, **When** the builder opens, **Then** "After each attempt" is selected for showing the correct answers, with a line saying why it's the default.
2. **Given** an existing quiz, **When** it is opened or saved, **Then** its setting is whatever was saved; nothing changes it.
3. **Given** a module shown to learners that has at least one shown video and no shown quiz and no shown video with questions, **When** the instructor opens the lesson drop-off view, **Then** the module is named in a note suggesting they add questions.
4. **Given** every shown module with video also has a quiz or a video with questions, **When** the drop-off view opens, **Then** there's no note.

---

### Edge Cases

- **Several questions at one moment**: asked one after another, in the instructor's order, before the video resumes.
- **A question at 0:00**: asked when playback starts.
- **A question timed after the end of the video that is playing** (the video was replaced with a shorter one, or the previous version is still playing while a replacement is processed): it is asked with the end check, and the editor marks it "after the end of the video".
- **Video replaced**: the questions stay on the item with their moments. Learners' answers are kept.
- **Resuming past a question**: a learner whose saved position is after an unanswered question isn't asked it on resume; its marker shows it as unanswered.
- **Playback speed, captions and volume**: unchanged by a question. Captions and speed carry on after Continue.
- **Fullscreen**: the question appears inside the fullscreen player; the learner isn't dropped out of fullscreen.
- **Picture-in-picture**: when a question is due while the video is in picture-in-picture, the video pauses and returns to the page so the question can be seen.
- **Player shortcuts while a question is open**: Space, arrows, number keys and the other player shortcuts don't play or seek the video underneath. Escape skips an unanswered question and closes an answered one.
- **Small screens**: a question that doesn't fit in the video's frame extends below it and scrolls with the page, with no horizontal scrolling at 375 px.
- **Submitting twice** (double click, retry after a lost connection): one answer is recorded, and the second request returns the recorded result.
- **Two tabs answering the same question differently**: the first answer to land is the recorded one, and the other tab is shown that recorded answer.
- **Saving the answer fails**: the question stays open with the learner's choice and a retry message. Skip still works, so a network fault never traps the learner.
- **Questions fail to load**: the video plays as if it had none. A failure never blocks the video.
- **Archived course**: the course is read-only, so no answer can be recorded. Videos in it play without questions.
- **Video, lesson or module hidden or archived while a learner has a question open**: submitting is refused with "no longer available", as for a quiz.
- **Learner drops the course**: their answers are kept, as their other records are. They can't answer more.
- **Instructor removes every question**: the video goes back to playing exactly as before, and its row no longer shows a question count.
- **Video still processing or failed**: the editor can't open until there's a version to play, because moments are picked on the video.
- **Screen readers**: when a question opens, its heading is announced with its time. The result is announced when it arrives. When the question closes, focus returns to the player's play button.
- **Reduced motion**: the question appears without animation when the learner's system asks for reduced motion.

## Requirements *(mandatory)*

### Functional Requirements

**Authoring**

- **FR-001**: An instructor of a course MUST be able to add, edit, remove and reorder questions on a video item, each either at a moment in the video (whole seconds from the start) or at the end. Only instructors who teach the course may do so, enforced by the service and not only by the editor.
- **FR-002**: A video question MUST use the quiz question model: single or multiple choice, a rich-text prompt, 2 to 10 options, the correct options, and an optional rich-text explanation, with the same validation rules as a quiz question.
- **FR-003**: A video MUST hold at most 20 questions, timed and end questions together. A video with none behaves in every way as videos do today.
- **FR-004**: A video's questions MUST be saved together as one document against the version the editor loaded. Of two saves made from the same version exactly one lands, and the other is refused with a message to reload.
- **FR-005**: Questions MUST NOT be editable while the video, its lesson, its module or its course is archived, with the same messages as other edits.
- **FR-006**: The editor MUST let the instructor pick a question's moment from the video's current position and type it exactly, MUST list questions in the order learners meet them, and MUST mark a question timed after the end of the video.
- **FR-007**: The instructor MUST be able to preview a video with its questions as a learner would see them. A preview records nothing and always shows the correct answers.
- **FR-008**: The lesson's content row MUST show how many questions a video has.

**Learner experience**

- **FR-009**: While an enrolled learner plays a video, the player MUST pause when normal playback reaches the moment of a question they haven't answered or skipped on this visit, and MUST show the question over the video.
- **FR-010**: The learner MUST be able to submit an answer or skip. A skip records nothing.
- **FR-011**: After an answer is recorded, the learner MUST be shown whether it was correct, the correct options and the explanation when there is one, before the video resumes. Right and wrong MUST be shown with an icon and words, not colour alone.
- **FR-012**: Continue, Skip and Close MUST return the learner to the video at the moment it paused, playing again if it was playing when the question opened.
- **FR-013**: The correct options and explanation of a question MUST NOT be sent to a learner before their answer to that question is recorded.
- **FR-014**: Seeking past a question's moment MUST NOT open it. Only normal playback reaching the moment, or the learner choosing its marker, opens a timed question.
- **FR-015**: A question the learner has answered MUST NOT be asked again by playback, on any visit or device.
- **FR-016**: The seek bar MUST show a marker for every timed question at its moment and one for the end check. Each marker MUST be reachable and usable from the keyboard, MUST name its time and state for assistive technology, and MUST distinguish answered from unanswered without relying on colour.
- **FR-017**: Choosing a marker MUST open its question: an unanswered one to answer, an answered one to review with the learner's recorded answer, the correct options and the explanation.
- **FR-018**: A learner reviewing an answered question MUST be able to try it again. A retry is checked in the browser and MUST NOT change the recorded answer or any figure.
- **FR-019**: When a video with unanswered end questions finishes, the end check MUST start by itself, ask them in the instructor's order, and end with a summary of how many end questions the learner has answered correctly. Each question can be skipped and the check can be closed.
- **FR-020**: A learner who leaves while a question is open MUST, on returning, resume just before that question.
- **FR-021**: A video without questions MUST play exactly as today: same controls, same requests apart from what's needed to learn that it has none, no pauses.
- **FR-022**: Failing to load a video's questions MUST NOT stop the video playing, and failing to record an answer MUST NOT trap the learner in the question.

**Low stakes**

- **FR-023**: Video questions MUST NOT have a pass mark, an attempt limit or a score that is stored against the learner.
- **FR-024**: Answering, missing or skipping a video question MUST NOT change whether the video is complete, lesson or course progress, course completion, any quiz's result, or whether a certificate is issued. A video is still completed only by **Mark as done**.
- **FR-025**: A learner MUST never be required to answer a question to keep watching or to move on.

**Recording**

- **FR-026**: The first answer a learner submits to a question MUST be recorded with the options chosen, whether it was correct against the key at that time, and when. It is never changed, replaced or regraded afterwards.
- **FR-027**: An answer MUST be recorded only for a learner enrolled in the course (not dropped), in a published course, for a video that is shown to students (it, its lesson and its module visible and not archived).
- **FR-028**: Submitting an answer to a question that is already answered MUST return the recorded answer and record nothing more.
- **FR-029**: A learner who has answered a video question has used that video: the item MUST count them once among its students, alongside those who marked it done, so that it can't be permanently deleted. Recording an answer also counts as the learner's activity in the course on that day.

**Editing after answers**

- **FR-030**: Changing only a question's correct options or explanation MUST be invisible to a learner who has it on screen: their answer is graded against the current key.
- **FR-031**: When a question's prompt, kind or options have changed since the learner loaded it, submitting MUST record nothing and MUST tell the learner, who is then shown the updated question.
- **FR-032**: Removing a question MUST keep the answers already recorded for it. It is no longer asked or listed in results.
- **FR-033**: Changing a question's moment MUST NOT affect recorded answers.
- **FR-034**: The editor MUST warn an instructor who opens the questions of a video that learners have already used.

**Instructor results**

- **FR-035**: A course's analytics MUST list each video shown to students that has questions, and for a chosen video MUST show, per current question: its moment, the start of its prompt, the number of recorded answers, the number that were wrong, and the miss rate, ranked like quiz questions (most-missed first, with a minimum of 5 answers to be ranked).
- **FR-036**: These results MUST be available only to instructors of the course, MUST contain no learner identifier, and MUST follow the same freshness as the other analytics figures.

**Companions**

- **FR-037**: A new quiz MUST start with the correct answers shown after each attempt, both in the builder and when a quiz is created without stating the setting. Existing quizzes keep their saved setting.
- **FR-038**: The lesson drop-off view MUST name each module shown to students that has at least one shown video and no shown quiz and no shown video with questions.

**Accessibility**

- **FR-039**: When the video pauses for a question, keyboard focus MUST move to the question, and its heading MUST be announced. The result MUST be announced when it arrives. When the question closes, focus MUST return to the player.
- **FR-040**: Everything in the question, the markers and the editor MUST be usable with the keyboard alone. While a question is open, the player's keyboard shortcuts MUST NOT act on the video underneath.

**Platform**

- **FR-041**: The whole feature MUST work in local development with no cloud account.

### Key Entities

- **Video question**: a question attached to a video item: its kind, prompt and options, the correct options and optional explanation, and where it is asked (a moment in whole seconds, or the end). A video holds up to 20, saved together under one version number.
- **Answer sheet**: one learner's recorded answers to one video's questions: for each question answered, the options chosen, whether that was correct at the time, and when. Created by the learner's first answer on that video and added to by each later first answer. Entries are never changed.
- **Question figures**: per question, how many answers were recorded and how many were wrong. The same figures quizzes already keep, now also kept for video questions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner who plays a video straight through is asked every unanswered question on it, each within 1 second of its moment, and sees the explanation before the video resumes, 100% of the time in tests.
- **SC-002**: A video with no questions behaves identically before and after this feature: every existing player and lesson test passes unchanged.
- **SC-003**: Across every combination of correct, wrong and skipped answers in tests, video completion, lesson and course progress, quiz results and certificate issue are identical to the same learner's without any answers.
- **SC-004**: An instructor can add a timed question to a video and save it in under 2 minutes without leaving the course editor.
- **SC-005**: A learner can answer a question and be back watching in three actions: choose an option, Submit, Continue.
- **SC-006**: After 5 learners answer a question, the instructor's results show 5 answers and the right number of misses within 30 seconds, and stay equal to the recorded answers however requests race or repeat.
- **SC-007**: A recorded answer is never changed: after any sequence of instructor edits and learner retries in tests, each learner's recorded result for each question is the one their first answer got.
- **SC-008**: A keyboard-only learner can answer, skip, review and retry a question, and a screen-reader user hears the question when the video pauses and the result when it arrives.
- **SC-009**: The correct options of a question never reach a learner who hasn't answered it, checked for every learner-facing response in tests.

## Assumptions

- **Question types** are the two quizzes have: single and multiple choice. Free-text, numeric and hint-based questions are out of scope.
- **One recorded answer per question per learner.** The first answer is the one that counts for the instructor's figures, because it measures what the learner recalled from the video. Try again is practice and isn't recorded.
- **Skips aren't recorded.** A skipped question is asked again on the learner's next visit to the page. Instructors don't see skip counts in this version.
- **Answers are always revealed straight after answering.** There is no per-video setting to hide them: immediate feedback is the point of the feature.
- **No shuffling** of options, and no setting to turn questions off for a learner.
- **Seeking never forces a question**, including on a learner's first viewing. A learner who scrubs to the end skips the timed questions; the markers show what they passed.
- **Archived courses** show videos without their questions, because nothing can be recorded there.
- **Up to 20 questions per video**, chosen as a generous ceiling for a lesson video: one every three minutes of an hour-long lecture.
- **The instructor's preview** uses the answer key the instructor already has and records nothing, like the quiz builder's "Preview as student".
- **"Reveal answers after each attempt"** is already what the quiz builder selects for a new quiz. This feature pins that with tests, adds the same default where a quiz is created without the setting, and explains it in the builder.
- **A module "has questions"** when it has a shown quiz item or a shown video with at least one question. Assignments don't count.
- **Notifications**: nothing notifies learners when questions are added to a video they've watched.
- **Dependencies and follow-ups**: the transcript panel (#590) and the AI tutor (#289, which will later offer hints on these questions) are separate specs. Neither is needed here, and this spec leaves room for both: questions are addressed by a stable identifier and a moment in the video.
- **Related work this builds on**: quiz content items and live course editing (#148), the player upgrades (#277) and instructor analytics (#278), all on `main`.
