/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcribeComplete } from './transcribe-complete.js';

const { getCaptionJob, applyTranscribeOutcome } = vi.hoisted(() => ({
  getCaptionJob: vi.fn(),
  applyTranscribeOutcome: vi.fn(),
}));

vi.mock('./transcribe-client.js', () => ({ getCaptionJob }));
vi.mock('./transcribe-outcome.js', () => ({ applyTranscribeOutcome }));

const buildEvent = (status: string, detail: object = {}) => ({
  version: '0',
  id: 'event-1',
  source: 'aws.transcribe',
  account: 'test-account',
  time: '2024-01-01T00:00:00.000Z',
  region: 'ap-southeast-2',
  resources: [],
  'detail-type': 'Transcribe Job State Change',
  detail: {
    TranscriptionJobName: 'captions-item-1-nonce-1',
    TranscriptionJobStatus: status,
    ...detail,
  },
});

const job = {
  status: 'COMPLETED',
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  nonce: 'nonce-1',
  vttKey: 'courses/x/transcribe-output/nonce-1/captions-item-1-nonce-1.vtt',
};

beforeEach(() => {
  vi.clearAllMocks();
  getCaptionJob.mockResolvedValue(job);
  applyTranscribeOutcome.mockResolvedValue(undefined);
});

describe('transcribeComplete', () => {
  it('looks the job up for its tags and subtitle location, and applies the outcome', async () => {
    await transcribeComplete(buildEvent('COMPLETED') as any);

    expect(getCaptionJob).toHaveBeenCalledWith('captions-item-1-nonce-1');
    expect(applyTranscribeOutcome).toHaveBeenCalledWith(expect.anything(), {
      jobName: 'captions-item-1-nonce-1',
      status: 'COMPLETED',
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      contentItemId: 'item-1',
      nonce: 'nonce-1',
      vttKey: job.vttKey,
    });
  });

  it('passes a FAILED status through', async () => {
    await transcribeComplete(
      buildEvent('FAILED', { FailureReason: 'Bad audio' }) as any,
    );

    expect(applyTranscribeOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('rejects a detail without the job name', async () => {
    const event = buildEvent('COMPLETED');
    (event.detail as any).TranscriptionJobName = undefined;

    await expect(transcribeComplete(event as any)).rejects.toThrow();
    expect(applyTranscribeOutcome).not.toHaveBeenCalled();
  });

  it('rethrows a failed lookup so the event is retried', async () => {
    getCaptionJob.mockRejectedValue(new Error('Transcribe is unavailable'));

    await expect(
      transcribeComplete(buildEvent('COMPLETED') as any),
    ).rejects.toThrow('Transcribe is unavailable');
    expect(applyTranscribeOutcome).not.toHaveBeenCalled();
  });

  it('rethrows a failed outcome so the event is retried', async () => {
    applyTranscribeOutcome.mockRejectedValue(new Error('DynamoDB is down'));

    await expect(
      transcribeComplete(buildEvent('COMPLETED') as any),
    ).rejects.toThrow('DynamoDB is down');
  });
});

describe('transcribeComplete for a course preview', () => {
  it('applies the outcome to the preview its job was tagged for', async () => {
    getCaptionJob.mockResolvedValue({
      target: 'coursePreview',
      status: 'COMPLETED',
      courseId: 'course-1',
      nonce: 'nonce-1',
      vttKey: job.vttKey,
    });

    await transcribeComplete(buildEvent('COMPLETED') as any);

    expect(applyTranscribeOutcome).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      {
        target: 'coursePreview',
        jobName: 'captions-item-1-nonce-1',
        status: 'COMPLETED',
        courseId: 'course-1',
        nonce: 'nonce-1',
        vttKey: job.vttKey,
      },
    );
  });
});
