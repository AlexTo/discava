/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createInProcessQueue } from './in-process-queue.js';

const message = (body: string) => ({ body, attributes: { feature: 'f' } });

const setup = () => {
  let time = 0;
  const queue = createInProcessQueue({
    visibilityTimeoutMs: 1000,
    redrive: { main: { failureQueue: 'failed', maxReceiveCount: 3 } },
    now: () => time,
  });
  return { queue, advance: (ms: number) => (time += ms) };
};

describe('createInProcessQueue', () => {
  it('delivers a message with its attributes and hides it while in flight', async () => {
    const { queue } = setup();
    await queue.sendBatch('main', [message('a')]);
    const [first] = await queue.receive('main', 10, 0);
    expect(first).toMatchObject({
      body: 'a',
      attributes: { feature: 'f' },
      receiveCount: 1,
    });
    expect(await queue.receive('main', 10, 0)).toEqual([]);
    expect(await queue.depth('main')).toEqual({ waiting: 0, inFlight: 1 });
  });

  it('returns a received message after the visibility timeout', async () => {
    const { queue, advance } = setup();
    await queue.sendBatch('main', [message('a')]);
    await queue.receive('main', 10, 0);
    advance(1000);
    const [again] = await queue.receive('main', 10, 0);
    expect(again?.receiveCount).toBe(2);
  });

  it('is gone once deleted', async () => {
    const { queue, advance } = setup();
    await queue.sendBatch('main', [message('a')]);
    const [received] = await queue.receive('main', 10, 0);
    await queue.delete('main', received?.receiptHandle ?? '');
    advance(5000);
    expect(await queue.receive('main', 10, 0)).toEqual([]);
    expect(await queue.depth('main')).toEqual({ waiting: 0, inFlight: 0 });
  });

  it('receives at most the number asked for', async () => {
    const { queue } = setup();
    await queue.sendBatch('main', [message('a'), message('b'), message('c')]);
    expect(await queue.receive('main', 2, 0)).toHaveLength(2);
  });

  it('moves a message to the failure queue after maxReceiveCount receives', async () => {
    const { queue, advance } = setup();
    await queue.sendBatch('main', [message('a')]);
    for (let i = 0; i < 3; i++) {
      expect(await queue.receive('main', 10, 0)).toHaveLength(1);
      advance(1000);
    }
    expect(await queue.receive('main', 10, 0)).toEqual([]);
    expect(queue.peek('failed')).toEqual([message('a')]);
    expect(await queue.depth('main')).toEqual({ waiting: 0, inFlight: 0 });
    expect(await queue.depth('failed')).toEqual({ waiting: 1, inFlight: 0 });
  });

  it('moves a message between queues', async () => {
    const { queue } = setup();
    await queue.sendBatch('failed', [message('a')]);
    const [received] = await queue.receive('failed', 1, 0);
    await queue.move('failed', 'main', received!);
    expect(queue.peek('failed')).toEqual([]);
    expect(queue.peek('main')).toEqual([message('a')]);
  });
});
