# Research: Start in Lesson One After Enrolling

What the code does today, for reference:

- `enrolment-actions.tsx` (student portal course page): `course.enrol` succeeds, the result is written to the `course.myEnrolment` cache and a "You're enrolled!" dialog opens with **Keep browsing** and **Start learning**, which links to `/learn/$courseId/home`. For a priced course, `use-checkout-return.ts` polls `course.myEnrolment` while the address says `?checkout=success` and calls `onEnrolled` (the same dialog) when the enrolment appears after having been waited for.
- The course home's "Start here" card and My Learning's **Continue** both go to `nextLesson`: the first lesson, in course order, that is not complete. The portal computes it in `use-course-player.ts` from `course.view` (which lists only what students may see), `course.myItemCompletions` and `course.myLessonProgress`; core-api computes the same thing in `my-enrolments.ts` with `filterEffectivelyVisible`.
- `QuestionsSection` on the lesson page lists the lesson's questions and shows the ask form (title and details). `discussionWrites` in core-table is the only writer of posts; `answeredState` decides the Unanswered queue.
- A per-course instructor setting such as certificates is an attribute on `course`, set by an instructor-api procedure (`course.setCertificates`) and edited by a small component on the course's page in the instructor portal (`course-certificates-switch.tsx`, beside `course-price-form.tsx`).
- Analytics: `contributions(entity, image)` in `analytics-contributions.ts` says what one record adds to the aggregates. The stream handler applies `contributions(after) - contributions(before)` once per stream event (an `EVENT#<eventID>` marker makes a redelivery a no-op), the rebuild sums `contributions` over a course's records, and the `analytics-matches-records` invariant compares that sum with what is stored. Distinct active learners per period use `MEMBER` markers, and the lesson funnel uses `FUNNEL` markers because its counts depend on two records.

## R-1: Where the learner lands, and how the portal finds the page

**Decision**: After enrolling, the course page navigates to a new route, `/learn/$courseId/start`. It shows a loading state, reads the course with `useCoursePlayer`, and as soon as the learner's place is known it replaces itself with `/learn/$courseId/lesson/<nextLesson>`; when the course shows no lesson it replaces itself with `/learn/$courseId/home`. `useCoursePlayer` gains `isPlaceReady` (course, completions and lesson progress all loaded), so a learner who comes back to a course is not sent to lesson one before their completions arrive.

**Rationale**:
- `nextLesson` already is "the first shown lesson" for a new learner and "where they left off" for one who re-enrols after leaving (their completions are kept). One rule, already tested, covers acceptance scenarios 1, 3 and 5, and the fallback is the same `nextLesson === undefined` case the course home handles today.
- The queries the start route runs are the ones the lesson page needs next, so they are served from the cache: no extra round trip.
- `replace` keeps the start route out of the history: Back from the lesson returns to the course page.
- "First item ready to play" needs no code: the lesson page already renders the first item at the top with its player. Nothing is autoplayed (spec clarification).

**Alternatives considered**:
- *Return the lesson id from `course.enrol`*: a paid enrolment is created by the payment webhook, not by `course.enrol`, so the paid path would still need something else. It also duplicates the "next lesson" rule in a third place.
- *Work it out inside `EnrolmentActions`* with three `fetchQuery` calls: the same reads, but tangled into a component that already has many states, and not reusable by the paid return.
- *Use the public course outline the course page already has*: it knows the first shown lesson but not the learner's completions, so a returning learner would restart at lesson one.
- *Land on the course home and auto-open the lesson*: keeps the stop the issue wants removed.

## R-2: The return from a paid checkout

**Decision**: `useCheckoutReturn` reports "enrolled after a successful checkout" in both cases: the enrolment appeared while polling, or it was already there on the first read (the webhook beat the redirect). The course page then navigates to the start route with `replace: true`. The `confirming` and `timed-out` states, the 2 s poll, the 60 s limit and the rule that the address alone grants nothing are unchanged (checkout spec, `contracts/student-portal-ui.md`).

**Rationale**: Today the "already enrolled on return" case shows the enrolled card with a **Start learning** button, one click short of the goal, and it is the common case when the webhook is fast. `replace` removes `?checkout=success` from the history, so Back cannot bounce the learner into the lesson again (FR-007), and a bookmarked return address only ever resumes them where they are (the start route's rule), never lesson one.

**Alternatives considered**: redirecting only when the enrolment has no `lastActivityAt` (a guard against old bookmarks): unnecessary, since the start route resumes instead of restarting. Changing the Stripe success URL to point at the start route: the start route would then need the whole waiting state, which belongs with the buy button.

**Fit with the checkout spec**: its student portal buy flow (Phase 7) is merged, so this builds on it. Its open phases that edit `enrolment-actions.tsx` (9, 10, 12, 13) add branches for cancelled, ended, refundable and leavable enrolments and do not touch `enrol.onSuccess`, `onEnrolled` or the dialog. Either order merges; the second resolves a small conflict. Its Phase 10 and 13 let a learner enrol again in a free course through the same `course.enrol` call, which then lands them through the start route with no further work.

## R-3: Confirming the enrolment without a dialog

**Decision**: The start route navigates with router history state `{ enrolled: true }`. The lesson page and the course home render `EnrolledNotice` ("You're enrolled in <course>.", `role="status"`) when that state is set.

**Rationale**: History state belongs to that one history entry, so the line is not shown when the learner opens the lesson later, and it cannot be bookmarked or shared the way a `?enrolled=1` search parameter could. The student portal has no toast component, and adding one for a single line is not worth a dependency.

**Alternatives considered**: keep the dialog and change its button (still a stop before learning); a search parameter (survives in bookmarks and shared links); no confirmation (a learner who has just paid should be told it worked). A reload of that same entry shows the line again, which is harmless.

## R-4: Where "answered or dismissed" is remembered

**Decision**: An optional attribute on the learner's `enrolment`, `firstLessonPromptState: 'answered' | 'dismissed'`. Absent means the prompt is still open. It is set once, under the condition that it is not set and the enrolment has not ended, and nothing removes it. Two helpers in `core-table/src/helpers/first-lesson-prompt.ts` are its only writers: `firstLessonPromptStateWrites` (a transaction item, used by `discussionWrites` for an answer) and `dismissFirstLessonPrompt` (runs its own write).

**Cost in records**: none. The enrolment is the one record that already exists per learner and course, and the lesson page already reads it (`course.myEnrolment`), so showing or hiding the prompt costs no extra read either. An answer or dismissal is one extra write to it, once per learner and course.

**Rationale**:
- Server-side, so it follows the learner across devices and browsers (FR-013), which browser storage cannot do.
- An enrolment survives ending and renewal (`course.enrol` brings a dropped enrolment back), so the state survives too, as the spec asks.
- Putting the write in the same transaction as the answer's post gives "at most one answer" for free: the second transaction fails the "not set" condition.

**Effect on stream consumers**: only `analytics-update` listens to enrolment changes (`ANALYTICS_STREAM_FILTERS`). It will see one more `MODIFY` per learner and course, and count it (R-8). Progress recalculation, notifications, search and earnings do not match enrolment records.

**Alternatives considered**:
- *A new entity, one record per learner and course*: one more record per enrolment that closes the prompt, a new entity to register, snapshot and check, and an extra read on the first lesson's page, all to hold one value that has an obvious home.
- *Derive "answered" from the posts*: there is no index by author, and adding one costs a write on every post in every course. Dismissal would still need storing somewhere.
- *The user record or a preferences record*: the state is per course, so it would be a growing map on one item.
- *Browser storage*: ruled out by the issue's acceptance criterion; the prompt would return on a second device.

## R-5: What an answer is

**Decision**: A `discussionPost` of kind `question` in the first shown lesson, with `promptAnswer: true` (read-only, questions only) and a title made from the answer's first line (trimmed to 120 characters, with an ellipsis when cut). `discussionWrites` gains an `answerPrompt` operation: the usual three checks (course published, module and lesson shown), the post's create, and the enrolment's state write, in one transaction. `answeredState` takes `promptAnswer` and returns a new value, `not-a-question`, so the post never gets the `unanswered` index attributes and every later operation (hide, unhide, accept, a reply deleted) keeps it out of the queue through the same function. The post's output gains `promptAnswer`, and `PostCard` shows "Answer to the course prompt".

**Rationale**:
- Reusing the question record means replies, upvotes, reports, hiding, deleting, the By lesson view, counts and their invariants all work unchanged.
- One text box matters: the study behind the issue is about getting a first post about the content, and a required title is friction.
- Keeping answers out of the Unanswered queue protects the instructor feature: a course with 500 enrolments would otherwise put up to 500 non-questions ahead of real ones. The queue's definition ("a question waiting for an instructor") stays true.

**Alternatives considered**:
- *An ordinary question through `discussion.ask`*: no data change at all, but floods the Unanswered queue and asks for a title.
- *One pinned thread per course, with answers as replies*: a thread takes at most 500 replies, every reply updates the thread's counters (a hot item), and each one would notify the thread's author.
- *A separate "introductions" record type*: a second moderation surface and list for the same kind of text.

## R-6: The prompt's text

**Decision**: The default is a constant, `DEFAULT_FIRST_LESSON_PROMPT`, in `first-lesson-prompt.ts`. A course may carry `firstLessonPrompt` (optional string, 1 to 200 characters after trimming, plain text). `resolveFirstLessonPrompt(course)` returns the course's text or the default. core-api's `course.view` returns the resolved text; instructor-api's `course.view` returns the course's own text (if any) and the default, and `course.setFirstLessonPrompt({ courseId, prompt })` sets it, or removes it when `prompt` is null or blank.

**Rationale**: Storing nothing for courses that use the default means a better default reaches every such course at once, and no course record needs backfilling. Absent here means "not customised", which is the attribute's meaning rather than a fallback for old data, so it does not need to be required the way `certificatesEnabled` and `priceAmount` are. The portals get the text from the APIs, so neither imports core-table.

**Alternatives considered**: copying the default onto every course at creation (existing courses need a backfill, and the default can never be improved for them); a rich-text prompt (the Q&A is plain text); an on/off switch (not asked for; left as an open question).

## R-7: Activation without a new counter source

**Decision**: An enrolment is activated when it has `lastActivityAt`. `contributions('enrolment', image)` adds `activated: 1` to the course summary and to the day the learner enrolled (`DAY#<createdAt>`), exactly when the image has `lastActivityAt`.

**Why this is correct under the existing markers**:
- `lastActivityAt` is written by `studentActivityWrites`, in the same transaction as every item completion, quiz attempt and assignment submission, and only ever moves forward. The `last-activity-at-current` invariant already checks it against the activity records. So "has `lastActivityAt`" is exactly "has done a first thing".
- The contribution is a pure function of one record's image. The first activity changes the enrolment from "no `lastActivityAt`" to "has one", and the handler applies the difference, +1, once: the `EVENT#<eventID>` marker turns a redelivered or redriven event into a no-op. Every later activity changes `lastActivityAt` from one value to another, and the difference is zero, so the handler writes nothing.
- Additions commute, so out-of-order delivery of two enrolment changes gives the same total. Removing an enrolment takes its contribution back, like `enrolments`.
- The rebuild and `analytics-matches-records` both sum `contributions`, so they agree with the stream by construction, and the invariant fails if they ever do not.
- No new stream traffic: each activity already modifies the enrolment, and the handler already receives it.

**Why not what analytics already keeps**: the lesson funnel's "started" counts are per lesson and leave out ended enrolments and hidden lessons, so they cannot be added up into "started anything". Active learners are distinct per day and week, with markers that expire, so they are not an all-time count. Neither gives activation by enrolment day.

**Alternatives considered**:
- *A marker per learner on the first `itemCompletion`*: exact to the issue's wording ("completed their first item"), but it is a new record per activated enrolment kept forever, plus a new marker kind in the handler, to distinguish one edge case (a learner whose only action is a quiz attempt they did not pass).
- *`progressPercent > 0`*: recalculated from currently visible items, so hiding an item could "de-activate" a learner.
- *A time window (activated within 7 days)*: needs the time of first activity, which is not kept (`lastActivityAt` moves), so it would need a new attribute. Left out; the page says "so far".

**Who counts**: every enrolment, including ended ones, as numerator and denominator (`activated / enrolments`). That matches the per-day `enrolments` counter, which has no per-day `dropped` to subtract, and keeps a learner who started and left as someone who started.

## R-8: What is measured

**Decision**: Per course, from counters only:

| Figure | From |
|--------|------|
| Activated, and activation share, all time | `courseStats.activated / courseStats.enrolments` |
| Activated, and share, of learners who enrolled in the last 30 or 90 days | the daily series' `activated` and `enrolments`, summed over the selected range |
| Prompt answers, prompt dismissals | `courseStats.promptAnswered`, `promptDismissed`, from `contributions('enrolment')` on `firstLessonPromptState` |

**Rationale**: The owner's question is "did more enrolled learners start after this shipped?". Activation attributed to the enrolment day answers it by comparing ranges, and because the figures are rebuilt from records, enrolments from before the feature are counted the same way (after a rebuild of existing courses, a **(human)** task). Prompt answers and dismissals say whether the prompt is used at all. The existing drop-off funnel and completion rate, on the same page, show whether anything changes further down. All of it reuses one mechanism.

**Not measured**: how often the prompt was shown (page views are not recorded), time to first activity, and any per-learner view. No experiment or holdout is built: the reported effects are a few percent, and a control group in a product with no users yet is not worth its code. Reminders, goal-setting and plan-making prompts stay out (issue #596).

## R-9: Enforcing "first lesson" and "once" on the server

**Decision**: `discussion.answerPrompt` calls `requireDiscussionAccess` (as `ask` does), requires the caller's enrolment (an instructor who is not enrolled is refused), reads the course's curriculum once and requires the lesson to be `firstShownLesson(...)`, a pure function beside `filterEffectivelyVisible`. It then runs `discussionWrites` `answerPrompt` under the existing `writeWithRetry`. A cancelled transaction is re-read: the same `postId` by the same author returns the stored post (a retry), and an enrolment whose state is already set gives `PRECONDITION_FAILED` "You've already answered or dismissed this prompt". `course.dismissFirstLessonPrompt` is idempotent: it returns the enrolment unchanged when the state is already set.

**Rationale**: The portal hides the prompt, but the rule has to hold for direct requests (FR-014, FR-015). The transaction's condition on the enrolment is what makes two simultaneous answers, or an answer and a dismissal, resolve to one outcome. The "first lesson" check is a read followed by a write, so an instructor reordering lessons at that instant could leave an answer in what was the first lesson a moment earlier. That is harmless and matches the spec (answers stay where they were posted), so no invariant ties an answer to the current first lesson.

## R-10: End-to-end tests and the shared `enrol` helper

**Decision**: The e2e helper `enrol(page, user?)` is used by fifteen scenarios and ends on the course home today. It keeps that ending: after pressing **Enrol now** it waits for the landing page and then opens the course home itself. A new helper, `enrolAndLand`, stops at the landing page and is what the new scenario uses.

**Rationale**: The dialog step must change (the dialog is gone), but making fifteen scenarios start from a different page would be a wide change that the implementing agent cannot run locally. Keeping the helper's end state confines the intended test change to one function and to `course-purchase.e2e.ts`, which clicked the dialog directly.
