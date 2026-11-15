# Quickstart: validating video player upgrades

Contracts: [core-api-video](./contracts/core-api-video.md), [instructor-api-captions](./contracts/instructor-api-captions.md), [player-ui](./contracts/player-ui.md). Data: [data-model.md](./data-model.md).

## Automated (an agent can run these without Docker)

```sh
pnpm nx affected --target test
pnpm nx affected --target lint
pnpm nx run @discava/infra:synth     # new rule, Lambda and policies
pnpm nx affected --target build
```

Expected: all green, including the new invariants and their breaking tests.

## End to end (CI runs it; a reviewer can run it locally with Docker)

```sh
pnpm dev
pnpm nx e2e @discava/e2e
```

Scenario `video.e2e.ts` (extended): an instructor uploads a short video; once ready it gets a placeholder default caption track; a student plays it for about 15 seconds, reloads, and the video resumes near where it stopped; the student turns captions on and the choice survives a reload; the instructor attaches a WebVTT track in another language and the student can pick it; a second attach for the same language replaces it. The core table invariants hold after the scenario.

## By hand (human)

1. Local, with `LOCAL_TRANSCODE_RENDITIONS=360p pnpm dev`: play, seek, change speed with the keyboard, open the captions menu. Save screenshots to `tmp/screenshots/pr-<number>/`.
2. On a deployed `discava-development` stage (only here): upload a video with speech and check a `.vtt` appears in its folder and shows as the default track within minutes; upload a video with no audio track and check it still becomes ready (research R-2); check the signed cookies serve the caption files in a browser from both portals; replace the video and check old tracks go and new ones appear.

## What only runs on dev

Real Amazon Transcribe accuracy and timing; the extra MediaConvert audio output; CloudFront cookie access to captions; the `Transcribe Job State Change` event and its retries. Locally the stand-in writes a placeholder track and calls the same completion code.
