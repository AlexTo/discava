# CLAUDE.md: packages/events

Loaded when working in `packages/events`. The repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

Standalone Lambda handlers for AWS-triggered events (e.g. Cognito), separate from the API.

## Local event runner

In local dev, the package's `dev` target runs the event runner (`src/local/event-runner.ts`), which triggers those handlers locally the way AWS does when deployed:

- the core table's stream → the stream router, which sends each change to the queue of every feature registered in core-table's `STREAM_FEATURES` (`helpers/stream-features.ts` lists them; the deployed `StreamRouter` construct reads the same registry), each with its own ElasticMQ queue, batching, retries and failure queue (`GET /router/queues`, `POST /router/redrive/{feature}` on port 2024; see `docs/.../design/stream-event-router.mdx`)
- standing in for MediaConvert, Transcribe, EventBridge Scheduler, Stripe and SES on port 2024:
  - ffmpeg transcodes in Docker (`src/local/transcoder.ts`, working in the git-ignored `tmp/local-dev/transcode/`; `LOCAL_TRANSCODE_RENDITIONS=360p` for speed) → transcode-complete
  - a Stripe stand-in (`src/local/stripe-stand-in.ts`: accounts, webhook endpoints, Checkout, and the Connect slice of Express accounts, onboarding links and transfers, kept in the git-ignored `tmp/local-dev/stripe-connect.json`; backend code points the `stripe` SDK at it when `LOCAL_DEV=true`, with the key kept in the git-ignored `tmp/local-dev/secrets/` in place of Secrets Manager)
  - a transcription stand-in (`src/local/transcriber.ts`) that writes a placeholder WebVTT track → transcribe-complete (caption writes go through `helpers/caption-tracks.ts` in core-table)
  - a translation stand-in (`src/local/translator.ts`) that prefixes each caption with its target language, used by the `caption-translation` stream feature's handler (`src/media/caption-translation.ts`)
  - delayed cleanups → transcode-cleanup
- `brand-publishing` (`src/branding/brand-publishing.ts`): on a `platformBrand` write, reads the current record (never the stream image) and puts `brand/brand.json` in the public media bucket, which the portals fetch; failures go to its own queue and alarm
- the daily payout run (`src/earnings/payout-run.ts`): `POST /payout-run` on port 2024 runs it once (optional `{ "graceSeconds": 0 }` replaces the 15-minute recovery grace so a test can recover what an earlier run left), and `LOCAL_PAYOUT_RUN_INTERVAL_SECONDS` (default off) runs it on a timer; it moves money only through the Stripe stand-in
- a user first seen by an API's local server → pre-token-generation, which writes their `user` record as Cognito's trigger does when deployed (#230; `syncLocalUser` in `common-server-utils/local-dev`)

Backend code switches to these and S3Mock when `LOCAL_DEV=true` (see `common-server-utils/local-dev`); DEVELOPMENT.md's "Running Discava Locally" lists what only runs on a deployed stage.
