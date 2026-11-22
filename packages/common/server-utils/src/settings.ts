/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deploy-time settings: the CDK puts each setting's JSON in a Lambda
 * environment variable named by `settingEnvName`, and this module reads it.
 * Pure and synchronous, with no AWS SDK, so the constructs share it.
 */

const words = (name: string): string[] =>
  name.split(/(?<=[a-z0-9])(?=[A-Z])/).map((word) => word.toUpperCase());

/** `('s3', 'LessonMediaBucket')` gives `DISCAVA_S3_LESSON_MEDIA_BUCKET`. */
export const settingEnvName = (namespace: string, key: string): string =>
  ['DISCAVA', ...words(namespace), ...words(key)].join('_');

/**
 * Parses the setting's JSON, or undefined when the variable is unset or empty.
 * Error messages name the variable and never include its value.
 */
export const readOptionalSetting = <T>(
  namespace: string,
  key: string,
): T | undefined => {
  const name = settingEnvName(namespace, key);
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid deploy-time setting ${name}`);
  }
};

export const readSetting = <T>(namespace: string, key: string): T => {
  const value = readOptionalSetting<T>(namespace, key);
  if (value === undefined) {
    throw new Error(
      `Missing deploy-time setting ${settingEnvName(namespace, key)}`,
    );
  }
  return value;
};
