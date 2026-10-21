/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export { getDynamoDBClient, resolveTableName } from './client.js';
export * from './entities/index.js';
export {
  CURRICULUM_ENTITIES,
  filterEffectivelyVisible,
  isShown,
} from './helpers/curriculum.js';
export {
  TRANSCODE_PENDING_ATTRIBUTES,
  transcodePendingFrom,
} from './helpers/transcode-pending.js';
export { isConditionalCheckFailed } from './helpers/utils.js';
export { createCoreTableService } from './service.js';
