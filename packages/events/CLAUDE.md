# CLAUDE.md: packages/events

Loaded when working in `packages/events`. The repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

Standalone Lambda handlers for AWS-triggered events (e.g. Cognito), separate from the API.

## Local event runner

In local dev, the package's `dev` target runs the event runner (`src/local/event-runner.ts`), which triggers those handlers locally the way AWS does when deployed:

- the core table's stream → the stream router, which sends each change to the queue of every feature registered in core-table's `STREAM_FEATURES` (`helpers/stream-features.ts` lists them; the deployed `StreamRouter` construct reads the same registry), each with its own ElasticMQ queue, batching, retries and failure queue (`GET /router/queues`, `POST /router/redrive/{feature}` on port 2024; see `docs/.../design/stream-event-router.mdx`)
- standing in for MediaConvert, Transcribe, EventBridge Scheduler, Stripe and SES on port 2024:
  - ffmpeg transcodes in Docker (`src/local/transcoder.ts`, working in the git-ignored `tmp/local-dev/transcode/`; `LOCAL_TRANSCODE_RENDITIONS=360p` for speed) → transcode-complete
  - a Stripe stand-in (`src/local/stripe-stand-in.ts`: accounts and webhook endpoints; backend code points the `stripe` SDK at it when `LOCAL_DEV=true`, with the key kept in the git-ignored `tmp/local-dev/secrets/` in place of Secrets Manager)
  - a transcription stand-in (`src/local/transcriber.ts`) that writes a placeholder WebVTT track → transcribe-complete (caption writes go through `helpers/caption-tracks.ts` in core-table)
  - delayed cleanups → transcode-cleanup
- a user first seen by an API's local server → pre-token-generation, which writes their `user` record as Cognito's trigger does when deployed (#230; `syncLocalUser` in `common-server-utils/local-dev`)

Backend code switches to these and S3Mock when `LOCAL_DEV=true` (see `common-server-utils/local-dev`); CONTRIBUTING.md's "Running Discava Locally" lists what only runs on a deployed stage.
