# Quickstart: checking the transcript panel and transcript search

## Prerequisites

- Docker running, `pnpm i` done.
- `pnpm dev` running: the portals, the APIs, the event runner, local OpenSearch and S3Mock.
- A published course with a lesson video, made as an instructor (Alice) in the instructor portal, and a student (Bob) enrolled in it. The local Transcribe stand-in gives every video one placeholder cue, so also upload a caption track with real lines:
  - save the file below as `sample.en.vtt` and attach it to the video as **English (US)** in the video's captions dialog;
  - for the language steps, attach a second file as **Spanish** with different text.

```text
WEBVTT

00:00:01.000 --> 00:00:04.000
Welcome to the lesson on gradient

00:00:04.000 --> 00:00:07.500
descent and how it finds a minimum.

00:00:09.000 --> 00:00:12.000
<v Ana>We start with a random point &amp; a step size.
```

## Automated checks

```sh
pnpm nx run @discava/common-web-utils:test -- --run webvtt video-player
pnpm nx run @discava/common-shadcn:test -- --run transcript-panel hls-video video-controls
pnpm nx run @discava/search:test -- --run transcripts
pnpm nx run @discava/core-table:test -- --run transcript-stream stream-features
pnpm nx run @discava/events:test -- --run transcript
pnpm nx run @discava/core-api:test -- --run transcript
pnpm nx run @discava/student-portal:test -- --run transcript lesson
pnpm nx run @discava/infra:synth
pnpm nx e2e @discava/e2e -- --grep "transcript"
```

All pass. The e2e tests post their screenshots on the PR.

## By hand: the panel (student portal, as Bob)

1. Open the lesson. The player has a "Transcript" button. Choose it: a panel lists three lines with their times, beside the video on a wide window.
2. The third line reads "We start with a random point & a step size." with no `<v Ana>` and no `&amp;`.
3. Play. The highlighted line follows the speech, and the page doesn't scroll.
4. Choose the first line. The video jumps to 0:01 and plays.
5. In the captions menu pick Spanish. The panel shows the Spanish lines and its heading names Spanish.
6. Turn captions off. The panel still shows the Spanish lines.
7. Reload the lesson. The panel is open.
8. With a video long enough to scroll: scroll the panel while playing. It stops following and shows "Jump to current line". Choose it: it follows again.
9. Keyboard only: Tab to the panel (one Tab from the player's controls), press Down twice, then Enter. The video is at the third line. Volume didn't change. Tab once more: focus leaves the panel.
10. With VoiceOver or NVDA: the panel is announced as "Transcript (English)", lines read as time then text, the current line is announced as current, and nothing is read out on its own while the video plays.
11. Narrow the window to 375 px. The panel is under the video, scrolls inside itself, and the page has no horizontal scrollbar.
12. Open a video with no captions (delete its tracks as Alice). There is no "Transcript" button.

## By hand: search (student portal, as Bob)

13. In the course player's header, search `gradient descent`. One request, `transcript.search`, is sent on submit and none while typing. The result names the module, lesson and video, shows 0:01, and marks "gradient" and "descent" (the words span two caption lines).
14. Choose it. The lesson opens at that video, paused at 0:01, with "Starting at 0:01". The address carries `item` and `t`.
15. Search a word that isn't in any caption. "No moments match" shows.
16. Type one character and submit. Nothing is requested and the hint shows.
17. Set captions to Spanish in the player, then search an English-only word: no moments. Search a Spanish word: found.

## By hand: access

18. Signed out, open `/learn/<courseId>/search?q=gradient`. You're sent to sign in.
19. Signed in as Dan (not enrolled), open the same address. You see what a course you can't enter shows, and the network panel shows `transcript.search` refused.
20. As Alice, hide the lesson. As Bob, search again at once: no result from it. Show the lesson again: within a minute the result is back.
21. As Alice, archive the course. As Bob, search still works.

## By hand: staying in step

22. As Alice, replace the English track with a file that says "stochastic" where it said "gradient". Within a minute, as Bob, "gradient" finds nothing and "stochastic" is found.
23. As Alice, remove the Spanish track. Within a minute a Spanish word finds nothing.
24. As Alice, delete the video. Within a minute its moments are gone. `curl 'http://127.0.0.1:<opensearch port>/transcripts/_count?q=contentItemId:<id>'` gives 0.
25. `GET http://localhost:2024/router/queues` lists `transcript-indexing` with an empty failure queue.
26. Run `pnpm nx run @discava/tooling-deploy:reindex-transcripts`. It prints the courses and items it went through, and a second run prints the same and removes nothing.

Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## On a deployed stage

Local OpenSearch shows a write to searches within about a second, and has no cold start. After deploying to `discava-development`:

- run `pnpm nx run @discava/tooling-deploy:reindex-transcripts --stage=discava-development` once, so videos captioned before the deploy are searchable;
- repeat steps 13, 20 and 22 with a real Transcribe track, noting how long a change takes to show (SC-006);
- after the stage has been idle, upload a track and check the `transcript-indexing` failure queue stays empty (research R-7).
