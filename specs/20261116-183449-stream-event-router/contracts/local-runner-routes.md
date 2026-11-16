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

`count` is the number of messages in the failure queue. The ElasticMQ implementation reads queue attributes; the in-process one reads its lists.

## POST /router/redrive/{feature}

Moves every message in the feature's failure queue back to its queue, once, and returns how many moved.

```json
{ "feature": "search-indexing", "redriven": 2 }
```

- `404` for an unregistered feature.
- Idempotent in effect: redriving an empty failure queue returns `redriven: 0`.
- It is a small runner helper (read, re-send, delete), not the queue service's redrive, because ElasticMQ's message-move support is not documented (research R-2).

## Runner behaviour the routes rely on

- The router function runs on the local stream's batches, with the same registry as the deployed router.
- Each feature runner polls its queue, batches by the registration, runs the handler, deletes on success, and lets a failed message return after the visibility timeout. After `maxReceiveCount` receives it moves the message to the failure queue and logs it.
- `reset-local-data` clears both (ElasticMQ is in-memory, so a restart does too).
