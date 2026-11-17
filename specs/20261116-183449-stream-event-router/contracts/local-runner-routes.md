# Contract: Local Event Runner Routes (router additions)

The event runner already serves transcode, schedule and sign-in routes on `LOCAL_EVENT_RUNNER.port` (2024). The router adds two for inspecting and replaying local queues. They exist only when `LOCAL_DEV=true`, like the rest of the runner. Notifications (#331) adds its own email routes beside these; the two sets don't share paths.

## GET /router/queues

Returns, per registered feature, the state of its queue and failure queue.

```json
{
  "features": [
    {
      "name": "search-indexing",
      "queue": { "waiting": 0, "inFlight": 0 },
      "failures": { "count": 0 }
    }
  ]
}
```

`count` is the number of messages in the failure queue. It is read from the queue's attributes.

## POST /router/redrive/{feature}

Moves every message in the feature's failure queue back to its queue, once, and returns how many moved.

```json
{ "feature": "search-indexing", "redriven": 2 }
```

- `404` for an unregistered feature.
- Idempotent in effect: redriving an empty failure queue returns `redriven: 0`.
- It is a small runner helper (read, re-send, delete), not the queue service's redrive, because ElasticMQ's message-move support is not documented (research R-2).

## POST /router/fail/{feature}

Makes the feature's local runner throw for its next N batches, so a failure can be reproduced end to end without touching the handler. For tests only.

```json
{ "batches": 5 }
```

Returns `{ "feature": "search-indexing", "failing": 5 }`. `{ "batches": 0 }` clears it.

- `404` for an unregistered feature.
- `403` unless `LOCAL_DEV=true`. The runner already refuses to start otherwise, so this is a second guard.
- It lives in the local runner only. No handler and no deployed code knows about it.
- A failing batch behaves exactly like a handler that threw: its messages return after the visibility timeout and move to the failure queue after `maxReceiveCount` receives.

## Runner behaviour the routes rely on

- The router function runs on the local stream's batches, with the same registry as the deployed router.
- Each feature runner polls its queue, batches by the registration, runs the handler, deletes on success, and lets a failed message return after the visibility timeout. After `maxReceiveCount` receives it moves the message to the failure queue and logs it.
- `reset-local-data` clears both (ElasticMQ is in-memory, so a restart does too).
