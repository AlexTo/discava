/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
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
  record('MODIFY', 'NewImage', 'contentItem'),
  record('INSERT', 'NewImage', 'course'),
  record('MODIFY', 'NewImage', 'course'),
  record('REMOVE', 'OldImage', 'course'),
  record('REMOVE', 'OldImage', 'lesson'),
  record('MODIFY', 'NewImage', 'progress'),
];

describe('featuresFor', () => {
  it('routes a record to exactly the matching feature', () => {
    expect(featuresFor(record('INSERT', 'NewImage', 'itemCompletion'))).toEqual(
      ['progress-recalculation'],
    );
    expect(featuresFor(record('MODIFY', 'NewImage', 'course'))).toEqual([
      'search-indexing',
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
    ).toEqual(['search-indexing', 'third']);
  });

  it('returns an empty list for a record matching none', () => {
    expect(featuresFor(record('MODIFY', 'NewImage', 'progress'))).toEqual([]);
    expect(featuresFor({})).toEqual([]);
  });
});

describe('STREAM_FEATURES', () => {
  it('has unique names', () => {
    const names = STREAM_FEATURES.map((feature) => feature.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('filters only name entities the core table defines', async () => {
    vi.stubEnv('LOCAL_DEV', 'true');
    const service = await createCoreTableService();
    vi.unstubAllEnvs();
    const entities = Object.keys(service.entities);
    for (const feature of STREAM_FEATURES) {
      for (const filter of feature.filters) {
        for (const entity of filter.entities) {
          expect(entities).toContain(entity);
        }
      }
    }
  });

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
