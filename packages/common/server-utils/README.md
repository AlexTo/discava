# @discava/common-server-utils

Runtime code shared by Discava's backend Lambdas: the tRPC APIs (`core-api`, `instructor-api`) and the event handlers (`packages/events`).

## What belongs here

Code **used by two or more backend Lambdas**. Code only one of them uses stays next to it (e.g. instructor-api's `mediaconvert-client.ts`) and moves here when a second one needs it.

Server-only: this package depends on AWS SDK and Powertools modules and must never be imported by the portals. Biome's `noRestrictedImports` rule in each portal enforces that.

## Using it

There's no `index.ts`. Import each module by its path, so a Lambda's bundle includes only the modules it uses:

```ts
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import { getSignedCloudFrontCookies } from '@discava/common-server-utils/lesson-media';
```

A module does no work when imported: configuration and secrets are read on first use.

## Modules

- `cors`: the `Access-Control-Allow-Origin` an API answers a request with, allowing credentials.
- `lesson-media`: lesson video URLs and the signed CloudFront cookies that let a viewer stream one video's directory.
