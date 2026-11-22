/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { createCoreTableService } from '../service.js';
import {
  BRAND_STREAM_FILTERS,
  matchesBrandStreamFilters,
} from './brand-stream.js';
import {
  EARNINGS_STREAM_FILTERS,
  matchesEarningsStreamFilters,
} from './earnings-stream.js';
import {
  featuresFor,
  STREAM_FEATURES,
  type StreamFeature,
} from './stream-features.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({
  eventName,
  dynamodb: { [image]: { __edb_e__: { S: entity } } },
});

// A sample of what the table's stream carries.
const SAMPLE = [
  record('INSERT', 'NewImage', 'itemCompletion'),
  record('MODIFY', 'NewImage', 'lesson'),
  record('MODIFY', 'NewImage', 'module'),
  record('INSERT', 'NewImage', 'contentItem'),
  record('MODIFY', 'NewImage', 'contentItem'),
  record('REMOVE', 'OldImage', 'contentItem'),
  record('INSERT', 'NewImage', 'course'),
  record('MODIFY', 'NewImage', 'course'),
  record('REMOVE', 'OldImage', 'course'),
  record('REMOVE', 'OldImage', 'lesson'),
  record('MODIFY', 'NewImage', 'progress'),
  record('INSERT', 'NewImage', 'progress'),
  record('REMOVE', 'OldImage', 'progress'),
  record('INSERT', 'NewImage', 'enrolment'),
  record('MODIFY', 'NewImage', 'enrolment'),
  record('REMOVE', 'OldImage', 'enrolment'),
  record('INSERT', 'NewImage', 'quizAttempt'),
  record('INSERT', 'NewImage', 'quizSummary'),
  record('MODIFY', 'NewImage', 'quizSummary'),
  record('INSERT', 'NewImage', 'notification'),
  record('INSERT', 'NewImage', 'notificationBroadcast'),
  record('INSERT', 'NewImage', 'order'),
  record('MODIFY', 'NewImage', 'order'),
  record('INSERT', 'NewImage', 'platformBrand'),
  record('MODIFY', 'NewImage', 'platformBrand'),
];

describe('the earnings entities', () => {
  const ENTITIES = [
    'earningEntry',
    'earningDay',
    'earningOrder',
    'payout',
    'payoutAccount',
  ];
  const EVENTS = [
    ['INSERT', 'NewImage'],
    ['MODIFY', 'NewImage'],
    ['REMOVE', 'OldImage'],
  ] as const;

  it.each(ENTITIES)(
    'route inserts, modifications and removals of %s to no feature',
    (entity) => {
      for (const [eventName, image] of EVENTS) {
        expect(featuresFor(record(eventName, image, entity))).toEqual([]);
      }
    },
  );

  it.each(ENTITIES)(
    'never pass the earnings filters, so recording cannot feed itself (%s)',
    (entity) => {
      for (const [eventName, image] of EVENTS) {
        const streamRecord = record(eventName, image, entity);
        expect(matchesEarningsStreamFilters(streamRecord)).toBe(false);
        expect(
          EARNINGS_STREAM_FILTERS.some(
            (filter) =>
              filter.eventName === eventName &&
              filter.image === image &&
              filter.entities.includes(entity),
          ),
        ).toBe(false);
      }
    },
  );
});

describe('the platform brand', () => {
  it.each(['INSERT', 'MODIFY'])(
    'routes a %s to brand publishing only',
    (eventName) => {
      expect(
        featuresFor(record(eventName, 'NewImage', 'platformBrand')),
      ).toEqual(['brand-publishing']);
    },
  );

  it('routes a removal to no feature', () => {
    expect(featuresFor(record('REMOVE', 'OldImage', 'platformBrand'))).toEqual(
      [],
    );
  });

  it('is matched by no other feature’s filters', () => {
    for (const feature of STREAM_FEATURES.filter(
      ({ name }) => name !== 'brand-publishing',
    )) {
      for (const filter of feature.filters) {
        expect(filter.entities).not.toContain('platformBrand');
      }
    }
    expect(
      BRAND_STREAM_FILTERS.every(({ entities }) =>
        entities.every((entity) => entity === 'platformBrand'),
      ),
    ).toBe(true);
    expect(
      matchesBrandStreamFilters(record('MODIFY', 'NewImage', 'order')),
    ).toBe(false);
  });
});

describe('featuresFor', () => {
  it('routes a certificate MODIFY (a LinkedIn use) to no feature', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'certificate'))).toEqual(
      [],
    );
  });

  it('routes a certificate MODIFY (a revocation) and a certificateEvent INSERT to no feature', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'certificate'))).toEqual(
      [],
    );
    expect(
      featuresFor(record('INSERT', 'NewImage', 'certificateEvent')),
    ).toEqual([]);
  });

  it('routes a record to exactly the matching feature', () => {
    expect(featuresFor(record('INSERT', 'NewImage', 'course'))).toEqual([
      'search-indexing',
    ]);
    expect(featuresFor(record('MODIFY', 'NewImage', 'quizSummary'))).toEqual([
      'progress-recalculation',
      'analytics-update',
    ]);
  });

  it('routes a course MODIFY to search indexing and the progress recalculation', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'course'))).toEqual([
      'progress-recalculation',
      'search-indexing',
    ]);
    expect(featuresFor(record('INSERT', 'NewImage', 'enrolment'))).toEqual([
      'analytics-update',
    ]);
  });

  it('routes a contentItem MODIFY to transcript indexing and the feature it reached before', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'contentItem'))).toEqual([
      'progress-recalculation',
      'transcript-indexing',
    ]);
    expect(featuresFor(record('INSERT', 'NewImage', 'contentItem'))).toEqual([
      'transcript-indexing',
    ]);
    expect(featuresFor(record('REMOVE', 'OldImage', 'contentItem'))).toEqual([
      'progress-recalculation',
      'transcript-indexing',
    ]);
  });

  it('routes a lesson or module MODIFY and REMOVE to transcript indexing and the feature they reached before', () => {
    for (const entity of ['lesson', 'module']) {
      expect(featuresFor(record('MODIFY', 'NewImage', entity))).toEqual([
        'progress-recalculation',
        'transcript-indexing',
      ]);
      expect(featuresFor(record('REMOVE', 'OldImage', entity))).toEqual([
        'progress-recalculation',
        'transcript-indexing',
      ]);
      // A new lesson or module has no videos yet.
      expect(featuresFor(record('INSERT', 'NewImage', entity))).toEqual([]);
    }
  });

  it('leaves the routing of a course and enrolment record unchanged', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'course'))).toEqual([
      'progress-recalculation',
      'search-indexing',
    ]);
    expect(featuresFor(record('INSERT', 'NewImage', 'enrolment'))).toEqual([
      'analytics-update',
    ]);
  });

  it('routes a course rating insert or modify to search indexing only', () => {
    for (const eventName of ['INSERT', 'MODIFY']) {
      expect(
        featuresFor(record(eventName, 'NewImage', 'courseRating')),
      ).toEqual(['search-indexing']);
    }
  });

  it('routes a review to no feature: only the tally it maintains is indexed', () => {
    for (const eventName of ['INSERT', 'MODIFY']) {
      expect(featuresFor(record(eventName, 'NewImage', 'review'))).toEqual([]);
    }
    expect(featuresFor(record('REMOVE', 'OldImage', 'review'))).toEqual([]);
  });

  it('sends a new item completion to progress and to analytics', () => {
    expect(featuresFor(record('INSERT', 'NewImage', 'itemCompletion'))).toEqual(
      ['progress-recalculation', 'analytics-update'],
    );
  });

  it('keeps the analytics aggregates and markers from every feature', () => {
    for (const entity of ['courseStats', 'periodStats', 'analyticsMarker']) {
      expect(featuresFor(record('MODIFY', 'NewImage', entity))).toEqual([]);
    }
  });

  it('sends a new notification or broadcast to notification delivery only', () => {
    for (const entity of ['notification', 'notificationBroadcast']) {
      expect(featuresFor(record('INSERT', 'NewImage', entity))).toEqual([
        'notification-delivery',
      ]);
    }
  });

  it('ignores a changed notification, so an email state patch cannot loop back', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'notification'))).toEqual(
      [],
    );
    expect(featuresFor(record('REMOVE', 'OldImage', 'notification'))).toEqual(
      [],
    );
  });

  it('routes an inserted or modified order to earnings recording only', () => {
    for (const eventName of ['INSERT', 'MODIFY']) {
      expect(featuresFor(record(eventName, 'NewImage', 'order'))).toEqual([
        'earnings-recording',
      ]);
    }
    expect(featuresFor(record('REMOVE', 'OldImage', 'order'))).toEqual([]);
  });

  it('routes a changed default caption track to caption translation', () => {
    const video = (tracks: unknown[]) => ({
      __edb_e__: { S: 'contentItem' },
      captionTracks: { L: tracks },
    });
    expect(
      featuresFor({
        eventName: 'MODIFY',
        dynamodb: {
          OldImage: video([]),
          NewImage: video([
            { M: { trackId: { S: 't' }, language: { S: 'en-US' } } },
          ]),
        },
      } as never),
    ).toContain('caption-translation');
  });

  it('routes a lesson MODIFY that only sets freePreview to progress recalculation and transcript indexing', () => {
    // Filters work on the entity name: transcript indexing receives every
    // lesson MODIFY and its handler skips one that leaves `isShown` as it was.
    // Search, analytics, notifications and earnings don't see it.
    expect(featuresFor(record('MODIFY', 'NewImage', 'lesson'))).toEqual([
      'progress-recalculation',
      'transcript-indexing',
    ]);
  });

  it('routes a record matching two features to both', () => {
    const features: readonly StreamFeature[] = [
      ...STREAM_FEATURES,
      {
        ...STREAM_FEATURES[1]!,
        name: 'third',
      },
    ];
    expect(
      featuresFor(record('MODIFY', 'NewImage', 'course'), features),
    ).toEqual(['progress-recalculation', 'search-indexing', 'third']);
  });

  it('returns an empty list for a record matching none', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'courseStats'))).toEqual(
      [],
    );
    expect(featuresFor({})).toEqual([]);
  });
});

describe('STREAM_FEATURES', () => {
  it('has unique names', () => {
    const names = STREAM_FEATURES.map((feature) => feature.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('filters only name entities the core table defines', async () => {
    const service = await createCoreTableService();
    const entities = Object.keys(service.entities);
    for (const feature of STREAM_FEATURES) {
      for (const filter of feature.filters) {
        for (const entity of filter.entities) {
          expect(entities).toContain(entity);
        }
      }
    }
  });

  it.each([
    ['INSERT', 'NewImage'],
    ['MODIFY', 'NewImage'],
  ] as const)(
    'sends a %s of a payment connection or an audit row to no feature (an order goes to earnings recording only)',
    (eventName, image) => {
      for (const entity of ['paymentConnection', 'paymentChange']) {
        expect(
          featuresFor({
            eventName,
            dynamodb: { [image]: { __edb_e__: { S: entity } } },
          }),
        ).toEqual([]);
      }
    },
  );

  it('has filters that each match at least one sample record', () => {
    for (const feature of STREAM_FEATURES) {
      for (const filter of feature.filters) {
        const matched = SAMPLE.some(
          (sample) =>
            sample.eventName === filter.eventName &&
            filter.entities.includes(
              (
                sample.dynamodb as Record<
                  string,
                  { __edb_e__: { S: string } } | undefined
                >
              )[filter.image]?.__edb_e__.S ?? '',
            ),
        );
        expect(matched, `${feature.name} ${filter.eventName}`).toBe(true);
      }
    }
  });
});
