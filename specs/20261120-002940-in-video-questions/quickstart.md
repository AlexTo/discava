# Quickstart: checking questions in videos

## Prerequisites

- Docker running, `pnpm i` done.
- `pnpm dev` running: the portals, the APIs, DynamoDB local, S3Mock and the event runner, which transcodes uploads with ffmpeg and keeps the analytics figures up to date.
- Sign in as **Alice** (instructor and student) in the instructor portal, and as **Bob** and **Dan** (students) in the student portal.
- A published course of Alice's with a lesson holding a video of a minute or more that has finished processing. `LOCAL_TRANSCODE_RENDITIONS=360p pnpm dev` makes that quicker. Enrol Bob and Dan.

## Automated checks

```sh
pnpm nx run @discava/core-table:test -- --run video-question analytics-contributions invariants
pnpm nx run @discava/instructor-api:test -- --run content-item-video-questions analytics
pnpm nx run @discava/core-api:test -- --run video-question completion content-item
pnpm nx run @discava/common-web-utils:test -- --run video-questions
pnpm nx run @discava/common-shadcn:test -- --run video-controls hls-video video-question
pnpm nx run @discava/student-portal:test -- --run video-questions
pnpm nx run @discava/instructor-portal:test -- --run video-questions lesson-drop-off quiz
pnpm nx e2e @discava/e2e -- --grep "video question"
```

All pass. The e2e scenarios post their screenshots on the PR, and the table's invariants hold after each.

## By hand

Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

### Instructor: add questions (Alice, instructor portal)

1. Open the course, find the video's row and choose **Questions**. The editor opens with the video and no questions.
2. Play to about 0:10, pause, and choose **Add a question here**. Write a prompt, two options, mark one correct, add an explanation. Add a second question at about 0:30 as multiple choice, and one with **Add an end question**.
3. **Save**. Close and reopen: the three questions are there, with markers on the bar. The row's button reads "Questions (3)".
4. Try to save a question with no correct option: the save is refused and the card is marked.
5. **Preview as student**: the video pauses at 0:10 with the question, the answer is checked, and nothing appears in Bob's or the analytics' data.
6. Open the editor in a second tab, save a change in the first, then save in the second: the second is told the questions changed and offered a reload.

### Learner: answer while watching (Bob, student portal)

7. Open the lesson and play the video. At 0:10 it pauses, the question shows and focus is on it. Answer wrongly: "Not quite", the correct option and the explanation show. **Continue**: the video plays on from 0:10.
8. At 0:30 press **Skip**: the video plays on. Seek back to 0:25 and play: the skipped question isn't asked again. Reload the page and play through 0:30: it is.
9. Reload and seek from 0:00 straight to 0:50: no question appears. The 0:10 marker shows a tick, the 0:30 one a dot.
10. Choose the 0:10 marker: Bob's recorded answer, the correct option and the explanation show. **Try again**, answer correctly: it says correct and "this answer isn't recorded".
11. Let the video end: the end question appears by itself as "Question 1 of 1". Answer it: the summary shows. **Mark as done** still works the same before, during and after.
12. Check the lesson's progress and the course's progress: the same as for a learner who watched without answering. The video isn't complete until **Mark as done**.
13. Go fullscreen and play through an unanswered question (as Dan): the question shows inside fullscreen.
14. With the keyboard only (as Dan): Tab to a marker, press Enter, choose an option with the arrow keys, Tab to **Submit answer**, Enter, then **Continue**. While the question is open, Space and the arrow keys don't play or seek the video. Escape skips.
15. At a 375 px wide window, open a question with long options: nothing scrolls sideways.
16. Open a video that has no questions: it looks and plays as before, and the network panel shows no `videoQuestion.view` request.

### Editing after answers

17. As Alice, change which option of the 0:10 question is correct, and save. The editor first shows "… learners have used this video". As Bob, open the 0:10 marker: his result still says what it did, and the key shown is the new one.
18. As Dan, open the 0:30 question and leave it on screen. As Alice, reword that question's prompt and save. As Dan, submit: he's told the question was updated and sees the new wording, and nothing was recorded until he answers again.
19. As Alice, remove the end question and save. Bob's and Dan's videos no longer show the end marker.
20. As Alice, archive the video and try **Delete permanently** from the Archived view: it's unavailable, because learners have used it.

### Instructor: results and nudges (Alice)

21. Open the course's analytics. Within 30 seconds of the answers, **Video questions** lists the video. Open it: the 0:10 question shows 2 answers and the right misses, and "Not enough answers yet" for ranking.
22. Add a module with only a video and no questions, publish it, and reload analytics: **Lesson drop-off** names that module. Add a question to its video: the note goes.
23. Start a new quiz in the builder: "Show the correct answers" is on **After each attempt**, with the hint under it.

### Screen reader (VoiceOver or NVDA)

24. Play through a question: its heading, "Question at 0:10", is announced when the video pauses. Submit: "Correct" or "Not quite" is announced. Continue: focus is back on Play.
25. Move through the markers: each says its time and whether it's answered.

## Data checks

Every e2e scenario ends by checking the table against core-table's invariants, so running any one of them after the steps above (with `pnpm dev` still running) checks the data they left. `activity-count-matches-students`, `video-answer-sheet-shape`, `video-questions-shape` and `analytics-matches-records` must report nothing.
