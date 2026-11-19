# @discava/common-server-utils

Runtime code shared by Discava's backend Lambdas: the tRPC APIs (`core-api`, `instructor-api`, `admin-api`) and the event handlers (`packages/events`).

## What belongs here

Code **used by two or more backend Lambdas**. Code only one of them uses stays next to it (e.g. instructor-api's `mediaconvert-client.ts`) and moves here when a second one needs it.

Server-only: this package depends on AWS SDK and Powertools modules and must never be imported by the portals. A `noRestrictedImports` override in the root `biome.json` enforces that for the portals, `common-shadcn`, `common-tiptap` and `common-web-utils`.

## Using it

There's no `index.ts`. Import each module by its path, so a Lambda's bundle includes only the modules it uses:

```ts
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import { getSignedCloudFrontCookies } from '@discava/common-server-utils/lesson-media';
```

A module does no work when imported: configuration and secrets are read on first use.

## Modules

- `cors`: the `Access-Control-Allow-Origin` an API answers a request with, allowing credentials.
- `media-keys`: what a lesson video's S3 keys encode, e.g. which transcode a manifest belongs to.
- `lesson-media`: lesson video URLs and the signed CloudFront cookies that let a viewer stream one video's directory.
- `lesson-media-bucket`: runtime config lookups, the S3 client, the lesson media and upload bucket names, and batched S3 listing and deletion.
- `lesson-files`: lesson file and assignment submission uploads: accepted types, keys, presigned uploads and copies.
- `captions`: where caption (WebVTT) files live and what an uploaded one must look like.
- `public-media`: tagging public media objects (course images) so abandoned uploads expire.
- `cleanup-scheduler`: schedules the transcode-cleanup Lambda to delete a job's or item's S3 output.
- `unsubscribe-token`, `unsubscribe`: the signed email unsubscribe link and the route that handles it.
- `stripe/*`: the Stripe client, connecting an account and registering its webhook, and the Stripe secrets.
- `trpc-api-base`, `trpc-middleware`, `trpc-handler`, `trpc-local-server`: what every tRPC API is built from: the base procedures and their plugins (auth, logging, metrics, tracing, errors), the Lambda handler, and the local dev server (`nx dev`).
- `local-dev`: local dev's endpoints and helpers for the Docker stand-ins and the event runner.
