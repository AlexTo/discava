/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deploy-time settings: the CDK puts each field of a setting in its own plain
 * Lambda environment variable named by `settingEnvName`, and this module reads
 * them. Pure and synchronous, with no AWS SDK, so the constructs share it.
 */

const words = (name: string): string[] =>
  name.split(/(?<=[a-z0-9])(?=[A-Z])/).map((word) => word.toUpperCase());

/**
 * `('s3', 'LessonMediaBucket', 'bucketName')` gives
 * `DISCAVA_S3_LESSON_MEDIA_BUCKET_BUCKET_NAME`. Without a field, the name of a
 * setting that is a single value.
 */
export const settingEnvName = (
  namespace: string,
  key: string,
  field?: string,
): string =>
  [
    'DISCAVA',
    ...words(namespace),
    ...words(key),
    ...(field === undefined ? [] : words(field)),
  ].join('_');

const readVariable = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

/**
 * Reads the setting's fields, each from its own variable. Throws naming the
 * first required field whose variable is unset or empty; an optional field
 * that is unset is left out. Error messages never include a value.
 */
export const readSetting = <
  Required extends string,
  Optional extends string = never,
>(
  namespace: string,
  key: string,
  fields: readonly Required[],
  optionalFields: readonly Optional[] = [],
): Record<Required, string> & Partial<Record<Optional, string>> => {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const name = settingEnvName(namespace, key, field);
    const value = readVariable(name);
    if (value === undefined) {
      throw new Error(`Missing deploy-time setting ${name}`);
    }
    result[field] = value;
  }
  for (const field of optionalFields) {
    const value = readVariable(settingEnvName(namespace, key, field));
    if (value !== undefined) result[field] = value;
  }
  return result as Record<Required, string> & Partial<Record<Optional, string>>;
};
