# Contract: Stream Feature Registration

The one definition both the deployed `StreamRouter` stack and the local event runner read. A feature adds an entry here, a handler and its tests, and changes nothing else (FR-005).

## Registry

`packages/databases/core-table/src/helpers/stream-features.ts`:

```ts
export interface StreamFilter {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}

export interface StreamFeature {
  /** Unique, kebab-case. Names the queue, failure queue, alarm and handler. */
  name: string;
  /** Records that pass any of these go to this feature. */
  filters: readonly StreamFilter[];
  /** The handler the feature's mapping invokes (an `events-*` function). */
  handler: string;
  batch: { maxRecords: number; windowSeconds: number };
  /** Receives before a message goes to the failure queue. */
  maxReceiveCount: number;
  /** Optional cap on concurrent handler runs. */
  maxConcurrency?: number;
}

export const STREAM_FEATURES: readonly StreamFeature[];

/** The names of the features a record is routed to. */
export const featuresFor: (record: StreamRecordLike) => readonly string[];
```

v1 entries: `progress-recalculation` (filters `PROGRESS_STREAM_FILTERS`, batch 100 / 5 s, 5 receives) and `search-indexing` (filters `SEARCH_STREAM_FILTERS`, batch 100 / 5 s, 5 receives, concurrency capped).

## Rules

- A record goes to every feature with a matching filter, as its own copy, and to no other (FR-002). A record matching none produces nothing.
- `featuresFor` is the only matching logic. The router and the local runner both call it, so they cannot disagree (FR-020).
- Tests (FR-022) fail when: a name repeats; a `handler` names no function; a filter names an entity the core table doesn't define; a filter matches nothing in a sample record set.
- Filters reuse the existing helpers and tests (`matchesProgressStreamFilters`, `matchesSearchStreamFilters`); the registry doesn't redefine them.

## Handler obligations (FR-011)

Every handler MUST be safe to run twice with the same records and with records in any order. It MUST derive its result from current data where order matters, and say in its file's header comment how. A new feature's tests include a duplicate and a reordered delivery.

## Adding a feature: checklist

1. An entry in `STREAM_FEATURES` (filters, batch, receives).
2. A handler and an `events-*` wrapper from `ts#lambda-function`.
3. Nothing else: the construct builds the queue, failure queue, alarm and mapping from the entry.
4. The handler's duplicate and reordered tests.
5. A line in the contributor page listing the feature's queue metrics (FR-019, FR-023).
