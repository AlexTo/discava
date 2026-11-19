/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTION_MAX_BYTES,
  captionKey,
  captionUploadKey,
  isWebVtt,
  transcribeInputKey,
  transcribeJobName,
  transcribeOutputPrefix,
} from './captions';

const ref = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
};

describe('captionKey', () => {
  it("is inside the version's folder", () => {
    expect(captionKey(ref, 'n1', 't1')).toBe(
      'courses/c1/modules/m1/lessons/l1/content-items/i1/n1/captions/t1.vtt',
    );
  });
});

describe('captionUploadKey', () => {
  it('is in the item’s captions folder, outside any version', () => {
    expect(captionUploadKey(ref, 'u1')).toBe(
      'courses/c1/modules/m1/lessons/l1/content-items/i1/captions/u1.vtt',
    );
  });
});

describe('CAPTION_MAX_BYTES', () => {
  it('is 1 MB', () => {
    expect(CAPTION_MAX_BYTES).toBe(1_048_576);
  });
});

describe('isWebVtt', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const cue = '00:00.000 --> 00:01.000\nHello';

  it('accepts a minimal file', () => {
    expect(isWebVtt(bytes(`WEBVTT\n\n${cue}\n`))).toBe(true);
  });

  it('accepts a header after WEBVTT, with a space or a tab', () => {
    expect(isWebVtt(bytes(`WEBVTT - title\n\n${cue}`))).toBe(true);
    expect(isWebVtt(bytes(`WEBVTT\ttitle\n\n${cue}`))).toBe(true);
  });

  it('accepts CRLF line endings', () => {
    expect(
      isWebVtt(bytes(`WEBVTT\r\n\r\n${cue.replace('\n', '\r\n')}\r\n`)),
    ).toBe(true);
  });

  it('accepts a byte order mark', () => {
    expect(isWebVtt(bytes(`﻿WEBVTT\n\n${cue}`))).toBe(true);
  });

  it('accepts non-Latin text', () => {
    expect(
      isWebVtt(
        bytes('WEBVTT\n\n00:00.000 --> 00:02.000\nこんにちは 你好 مرحبا'),
      ),
    ).toBe(true);
  });

  it('rejects a file that does not start with WEBVTT', () => {
    expect(isWebVtt(bytes(`\n${'WEBVTT'}\n\n${cue}`))).toBe(false);
    expect(isWebVtt(bytes(`webvtt\n\n${cue}`))).toBe(false);
    expect(isWebVtt(bytes(`1\n${cue}`))).toBe(false);
  });

  it('rejects WEBVTT run into other text', () => {
    expect(isWebVtt(bytes(`WEBVTTx\n\n${cue}`))).toBe(false);
  });

  it('rejects a file with no cue', () => {
    expect(isWebVtt(bytes('WEBVTT\n\nNOTE just a note\n'))).toBe(false);
    expect(isWebVtt(bytes('WEBVTT'))).toBe(false);
  });

  it('rejects NUL bytes', () => {
    expect(isWebVtt(bytes(`WEBVTT\n\n${cue}\0`))).toBe(false);
  });

  it('rejects invalid UTF-8', () => {
    const invalid = new Uint8Array([
      ...bytes('WEBVTT\n\n00:00.000 --> 00:01.000\n'),
      0xff,
      0xfe,
    ]);
    expect(isWebVtt(invalid)).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(isWebVtt(new Uint8Array())).toBe(false);
  });
});

describe('Transcribe locations', () => {
  it('names the job per item and version', () => {
    expect(transcribeJobName('i1', 'n1')).toBe('captions-i1-n1');
  });

  it('reads the audio file from the upload bucket by nonce', () => {
    expect(transcribeInputKey('n1')).toBe('transcribe-input/n1.mp4');
  });

  it('writes outside the version folder the signed cookies authorise', () => {
    const prefix = transcribeOutputPrefix(ref, 'n1');
    expect(prefix).toBe(
      'courses/c1/modules/m1/lessons/l1/content-items/i1/transcribe-output/n1/',
    );
    expect(prefix).not.toContain('/n1/captions/');
    expect(
      prefix.startsWith(
        'courses/c1/modules/m1/lessons/l1/content-items/i1/n1/',
      ),
    ).toBe(false);
  });
});

describe('preview caption paths', () => {
  it('keeps captions in the version folder and Transcribe output outside it', async () => {
    const m = await import('./captions.js');
    expect(m.previewCaptionKey('c', 'n', 't')).toBe(
      'courses/c/preview/n/captions/t.vtt',
    );
    expect(m.previewTranscribeOutputPrefix('c', 'n')).toBe(
      'courses/c/preview/transcribe-output/n/',
    );
    expect(m.previewTranscribeJobName('c', 'n')).toBe('captions-preview-c-n');
  });
});
