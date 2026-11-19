/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailPermanentError,
  EmailTransientError,
  sendEmail,
} from './email.js';

const { sesSend, callLocalEventRunner } = vi.hoisted(() => ({
  sesSend: vi.fn(),
  callLocalEventRunner: vi.fn(),
}));

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(function () {
    return { send: sesSend };
  }),
  SendEmailCommand: vi.fn(function (input) {
    return { __command: 'SendEmail', input };
  }),
}));

vi.mock('@discava/common-server-utils/local-dev', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@discava/common-server-utils/local-dev')
  >()),
  callLocalEventRunner,
}));

const message = {
  to: 'a@example.com',
  from: 'notifications@example.com',
  subject: 'Hello',
  text: 'text',
  html: '<p>html</p>',
  headers: {
    'List-Unsubscribe': '<https://x/u>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
};

const named = (name: string, text = name) =>
  Object.assign(new Error(text), { name });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendEmail deployed', () => {
  it('sends a simple SES v2 message with both headers', async () => {
    sesSend.mockResolvedValue({ MessageId: 'm-1' });

    await expect(sendEmail(message)).resolves.toEqual({ messageId: 'm-1' });

    expect(sesSend).toHaveBeenCalledWith({
      __command: 'SendEmail',
      input: {
        FromEmailAddress: message.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: 'Hello', Charset: 'UTF-8' },
            Body: {
              Text: { Data: 'text', Charset: 'UTF-8' },
              Html: { Data: '<p>html</p>', Charset: 'UTF-8' },
            },
            Headers: [
              { Name: 'List-Unsubscribe', Value: '<https://x/u>' },
              {
                Name: 'List-Unsubscribe-Post',
                Value: 'List-Unsubscribe=One-Click',
              },
            ],
          },
        },
      },
    });
    expect(callLocalEventRunner).not.toHaveBeenCalled();
  });

  it.each([
    'MessageRejected',
    'BadRequestException',
    'AccountSuspendedException',
    'SendingPausedException',
    'MailFromDomainNotVerifiedException',
  ])('maps %s to a permanent error', async (name) => {
    sesSend.mockRejectedValue(named(name));
    await expect(sendEmail(message)).rejects.toBeInstanceOf(
      EmailPermanentError,
    );
  });

  it.each([
    'Email address is not verified. The following identities failed the check',
    'Account is in the sandbox',
  ])('maps the message "%s" to a permanent error', async (text) => {
    sesSend.mockRejectedValue(named('SomethingElse', text));
    await expect(sendEmail(message)).rejects.toBeInstanceOf(
      EmailPermanentError,
    );
  });

  it.each([
    named('ThrottlingException'),
    named('TooManyRequestsException'),
    named('InternalServerError'),
    named('TimeoutError', 'socket hang up'),
  ])('maps $name to a transient error', async (error) => {
    sesSend.mockRejectedValue(error);
    await expect(sendEmail(message)).rejects.toBeInstanceOf(
      EmailTransientError,
    );
  });
});

describe('sendEmail in local dev', () => {
  it('posts to the event runner instead of calling SES', async () => {
    vi.stubEnv('LOCAL_DEV', 'true');
    callLocalEventRunner.mockResolvedValue({ id: 'local-1' });

    await expect(sendEmail(message)).resolves.toEqual({ messageId: 'local-1' });

    expect(callLocalEventRunner).toHaveBeenCalledWith(
      'POST',
      '/emails',
      message,
    );
    expect(sesSend).not.toHaveBeenCalled();
  });

  it('treats an unreachable runner as transient', async () => {
    vi.stubEnv('LOCAL_DEV', 'true');
    callLocalEventRunner.mockRejectedValue(new Error("isn't reachable"));
    await expect(sendEmail(message)).rejects.toBeInstanceOf(
      EmailTransientError,
    );
  });
});
