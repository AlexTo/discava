/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { service } from '../../table/src/service.js';

export const addGadget = () => {
  const { gadget: renamed } = service.entities;
  return renamed.put({ gadgetId: 'g' });
};
