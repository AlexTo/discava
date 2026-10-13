/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export { getDynamoDBClient, resolveTableName } from './client.js';
export {
  CURRICULUM_ENTITIES,
  filterEffectivelyVisible,
  isShown,
} from './curriculum.js';
export * from './entities/index.js';
export { createCoreTableService } from './service.js';
export { isConditionalCheckFailed } from './utils.js';
