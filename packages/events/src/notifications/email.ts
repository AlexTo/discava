/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import {
  callLocalEventRunner,
  isLocalDev,
  type LocalEmailRequest,
} from '@discava/common-server-utils/local-dev';

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  /** `List-Unsubscribe` and `List-Unsubscribe-Post`. */
  headers: Record<string, string>;
}

/** The provider will never accept this message: retrying cannot help. */
export class EmailPermanentError extends Error {
  override name = 'EmailPermanentError';
}

/** The send may succeed later: throttling, a 5xx or the network. */
export class EmailTransientError extends Error {
  override name = 'EmailTransientError';
}

const PERMANENT_ERROR_NAMES = new Set([
  'MessageRejected',
  'BadRequestException',
  'AccountSuspendedException',
  'SendingPausedException',
  'MailFromDomainNotVerifiedException',
]);

// SES reports a sandbox account or an unverified identity as a
// MessageRejected or BadRequest, but the messages are the stable part.
const PERMANENT_MESSAGE_PATTERNS = [
  /not verified/i,
  /sandbox/i,
  /identities failed the check/i,
];

const isPermanent = (error: unknown): boolean => {
  const { name, message } = error as { name?: string; message?: string };
  return (
    (name !== undefined && PERMANENT_ERROR_NAMES.has(name)) ||
    PERMANENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message ?? ''))
  );
};

let _sesClient: SESv2Client | undefined;

const getSesClient = (): SESv2Client => {
  if (!_sesClient) {
    _sesClient = new SESv2Client({});
  }
  return _sesClient;
};

const sendWithSes = async (message: EmailMessage): Promise<string> => {
  const response = await getSesClient().send(
    new SendEmailCommand({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            Html: { Data: message.html, Charset: 'UTF-8' },
          },
          Headers: Object.entries(message.headers).map(([Name, Value]) => ({
            Name,
            Value,
          })),
        },
      },
    }),
  );
  return response.MessageId ?? '';
};

/**
 * Sends one email: through SES v2 when deployed, and by posting it to the
 * local event runner's inbox in local dev. Provider failures are mapped to
 * `EmailPermanentError` or `EmailTransientError`.
 */
export const sendEmail = async (
  message: EmailMessage,
): Promise<{ messageId: string }> => {
  try {
    if (isLocalDev()) {
      const response = await callLocalEventRunner<{ id: string }>(
        'POST',
        '/emails',
        message satisfies LocalEmailRequest,
      );
      return { messageId: response?.id ?? '' };
    }
    return { messageId: await sendWithSes(message) };
  } catch (cause) {
    const reason = (cause as Error).message;
    if (!isLocalDev() && isPermanent(cause)) {
      throw new EmailPermanentError(reason, { cause });
    }
    throw new EmailTransientError(reason, { cause });
  }
};
